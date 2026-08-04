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
 * For a SPECULATIVE candidate — an alternative baud rate nobody configured.
 *
 * Two attempts rather than one, and not out of optimism: opening the port asserts
 * DTR, which resets an AVR or ESP8266, so the first read after the open can land
 * while the board is still booting. One attempt would reject a correct rate for a
 * reason that has nothing to do with the rate. Two is the floor that makes the
 * sweep trustworthy; more would multiply across every rate tried.
 */
export const SPECULATIVE_BOARD_ID_PROBE: ProbeBudget = { attempts: 2, backoffMs: 400 }

/**
 * Baud rates tried, in this order, when the configured one does not answer.
 *
 * A board whose baud nobody remembers is otherwise unreachable, and it fails in
 * the most misleading way available: the port opens (so it is not "no response"),
 * nothing decodes (so it reads as "no firmware"), and the user is told to reflash
 * a device that is running perfectly well. In the field that reflash is the
 * expensive part — it is why this sweep exists.
 *
 * Ordered by how often they occur in practice, not numerically. Deliberately
 * short: every wrong rate costs a port open, and on AVR/ESP8266 opening the port
 * asserts DTR and RESETS the board, so a wide sweep is not free — it restarts the
 * user's program once per guess.
 */
export const FALLBACK_BAUD_RATES = [115200, 9600, 57600, 19200, 38400] as const

/** One baud rate to try, and whether trying it is a guess. */
export interface BaudAttempt {
  baudRate: number | undefined
  /** True for a rate nobody configured — verification keeps these cheap. */
  speculative: boolean
}

/**
 * The order to try baud rates in for one serial endpoint: the configured rate
 * first, then every fallback that isn't it.
 *
 * The configured rate leads because it is nearly always right, and a correct
 * first try costs one port open. The guesses follow in `FALLBACK_BAUD_RATES`
 * order.
 *
 * Returns a single non-speculative attempt when there is no rate to sweep — a
 * TCP or WebSocket endpoint (`undefined`), or a caller that opted out.
 */
export function planBaudAttempts(declaredBaud: number | undefined, options: { sweep?: boolean } = {}): BaudAttempt[] {
  const declared: BaudAttempt = { baudRate: declaredBaud, speculative: false }
  if (options.sweep === false || typeof declaredBaud !== 'number') return [declared]

  return [
    declared,
    ...FALLBACK_BAUD_RATES.filter((baud) => baud !== declaredBaud).map((baud) => ({
      baudRate: baud,
      speculative: true,
    })),
  ]
}

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
 *
 * A SUCCESSFUL REPLY is the signal, not a non-empty id. `success` already means
 * the frame came back with the right function code and a SUCCESS status, which
 * only an OpenPLC firmware sends. The id itself is allowed to be empty: cores
 * without ArduinoUniqueID support, and boards that opt out with
 * `OPENPLC_NO_UNIQUE_ID`, deliberately answer `id_len = 0` rather than fail to
 * compile (see `debugGetBoardId` in modbus_debug.cpp). Requiring bytes here
 * reported those boards as having no firmware at all.
 */
export async function readBoardIdWithRetries(
  client: BoardIdReadable,
  { attempts, backoffMs }: ProbeBudget,
): Promise<{ success: boolean; boardId?: Uint8Array }> {
  let last: { success: boolean; boardId?: Uint8Array } = { success: false }
  for (let attempt = 0; attempt < attempts; attempt++) {
    const result = await client.getBoardId()
    last = { success: result.success, boardId: result.boardId }
    if (last.success) return last
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
    if (!probe.success) {
      // Channel opened but nothing spoke the debug protocol -> blank board, a
      // non-OpenPLC device, or the wrong baud rate. Whether the reply carried a
      // unique id is NOT part of this question — see `readBoardIdWithRetries`.
      return { status: 'no-firmware' }
    }
    return { status: 'connected-with-firmware' }
  } catch (error) {
    return { status: 'error', error: getErrorMessage(error) }
  }
}
