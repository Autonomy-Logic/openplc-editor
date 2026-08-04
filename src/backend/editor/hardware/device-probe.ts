/**
 * Connect-time classification of a device link (D72), over an ALREADY-CONNECTED
 * `DeviceChannelTransport`: it neither connects nor disconnects — the caller
 * holds the client open for the live link, so classification happens over a
 * SINGLE port open.
 *
 * Pure orchestration over the transport, so it is unit-testable with mocks.
 * Never throws — failures resolve to a status.
 */
import { getErrorMessage } from '../../../frontend/utils/get-error-message'
import type { DebugBoardIdResult } from '../../shared/debug/types'

/** Just enough of a channel to open it. */
type Connectable = { connect(): Promise<void> }

/**
 * Just enough of a channel to classify it. Narrower than
 * `DeviceChannelTransport`, where `getBoardId` is optional: a channel that
 * cannot answer the board-id read is not one this module can classify.
 */
type BoardIdReadable = { getBoardId(): Promise<DebugBoardIdResult> }

/** Retry budget for a bounded connect/probe loop. */
export interface ProbeBudget {
  attempts: number
  backoffMs: number
}

/**
 * How patiently to wait for a board to answer the id read (0x48).
 *
 * The generous default exists for ONE situation: a board that has just been
 * flashed and is still coming up. Six attempts at a 5s request timeout is ~32s of
 * patience, which is right when this is the only endpoint there is and the device
 * is expected to appear.
 *
 * It is wrong when the caller is CHOOSING between endpoints: 32s spent ruling out
 * a Modbus TCP address the user is not even using delays the serial connection
 * that would have worked. Such callers pass a short budget and move on.
 */
export const PATIENT_BOARD_ID_PROBE: ProbeBudget = { attempts: 6, backoffMs: 500 }
export const QUICK_BOARD_ID_PROBE: ProbeBudget = { attempts: 2, backoffMs: 300 }

/**
 * Connect with a bounded retry/backoff loop. A device flashed over arduino-cli
 * serial reboots as the programmer releases the port, so the first connect right
 * after an upload frequently races the reboot; retry, rethrowing the last error
 * only once every attempt is exhausted.
 */
export async function connectWithRetries(client: Connectable, { attempts, backoffMs }: ProbeBudget): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await client.connect()
      return
    } catch (error) {
      lastError = error
      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, backoffMs))
    }
  }
  throw lastError
}

/**
 * Read the board id (FC 0x48) with a bounded retry/backoff loop -- a readiness
 * probe for the firmware itself (the serial open auto-resets ESP8266/AVR boards).
 * A non-empty board id means a firmware answered.
 */
export async function readBoardIdWithRetries(
  client: BoardIdReadable,
  { attempts, backoffMs }: ProbeBudget,
): Promise<{ success: boolean; boardId?: Uint8Array }> {
  let last: { success: boolean; boardId?: Uint8Array } = { success: false }
  for (let attempt = 0; attempt < attempts; attempt++) {
    const result = await client.getBoardId()
    last = { success: result.success, boardId: result.boardId }
    if (last.success && !!last.boardId && last.boardId.length > 0) return last
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, backoffMs))
  }
  return last
}

/** How a freshly-opened channel classified. */
export type DeviceProbeStatus = 'connected-with-firmware' | 'no-firmware' | 'no-response' | 'error'

export interface DeviceProbeOutcome {
  status: DeviceProbeStatus
  error?: string
}

/**
 * Classify an already-connected candidate: did an OpenPLC firmware answer the
 * debug protocol on it?
 *
 * Only the board-id read decides. A channel that opens but answers nothing —
 * a blank board, or an IP that belongs to something else entirely — classifies
 * as `no-firmware`, so the caller can fall through to the next candidate rather
 * than keeping a link that cannot serve a single command.
 */
export async function classifyDeviceLink(
  client: BoardIdReadable,
  opts: { boardIdProbe?: ProbeBudget } = {},
): Promise<DeviceProbeOutcome> {
  try {
    const probe = await readBoardIdWithRetries(client, opts.boardIdProbe ?? PATIENT_BOARD_ID_PROBE)
    if (!probe.success || !probe.boardId || probe.boardId.length === 0) {
      // Channel opened but nothing spoke the debug protocol -> blank/non-OpenPLC.
      return { status: 'no-firmware' }
    }
    return { status: 'connected-with-firmware' }
  } catch (error) {
    return { status: 'error', error: getErrorMessage(error) }
  }
}
