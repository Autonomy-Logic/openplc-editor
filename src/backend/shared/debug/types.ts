import type { PlcRuntimeState } from '../simulator/types'

/**
 * Debug Transport Interface
 *
 * Defines the duck-typed contract that all debug transports must implement.
 * Mirrors the implicit interface from openplc-editor where ModbusTcpClient,
 * ModbusRtuClient, and WebSocketDebugClient all implement the same methods.
 *
 * openplc-web transports: ModbusRtuTransport (simulator), ModbusDataChannelTransport
 * (a WebRTC data channel, falling back to the Autonomy Edge relay per request).
 *
 * Which medium a session ends up on is NOT named here: the connection manager
 * publishes it as a `DebugMedium` (middleware/shared/ports/types), which is the one
 * vocabulary the debug poller reads. A second, near-identical union living here is
 * how the poller came to have two disagreeing sources for the same fact.
 */

export interface DebugTransportResult {
  success: boolean
  tick?: number
  lastIndex?: number
  data?: Uint8Array
  error?: string
}

export interface DebugSetResult {
  success: boolean
  error?: string
}

/**
 * Result of the always-on debugger status probe (FC 0x46). `running` is the
 * PLC scan liveness flag, `tick` the scan counter (advances each cycle), and
 * `uptimeMs` the milliseconds since the board booted.
 */
export interface DebugStatusResult {
  success: boolean
  running?: boolean
  tick?: number
  uptimeMs?: number
  /** Run/stop state (0 = STOPPED, 1 = RUNNING, 2 = ERROR). This is the single
   *  read path for run/stop — there is no separate query FC. `running` above is
   *  the same information as a boolean, kept for callers that only need
   *  liveness. Absent on firmware predating the run/stop state machine. */
  plcState?: number
  /** Mode-switch position (0 = STOP, 1 = RUN). Boards with no physical switch
   *  report RUN. Absent on firmware predating the run/stop state machine, which
   *  callers should read as "no gating". */
  switchPosition?: number
  error?: string
}

/** Result of the runtime version probe (FC 0x47) — ASCII version string. */
export interface DebugVersionResult {
  success: boolean
  version?: string
  error?: string
}

/**
 * Result of the board-id probe (FC 0x48). `boardId` is the raw unique-id bytes
 * (empty when the target has no unique-id support); `boardIdHex` is the same
 * bytes as a lowercase hex string for display.
 */
export interface DebugBoardIdResult {
  success: boolean
  boardId?: Uint8Array
  boardIdHex?: string
  error?: string
}

/**
 * Result of a write-license call (FC 0x49). The device stores the raw blob
 * bytes; `status` is the ModbusDebugResponse code the target returned
 * (SUCCESS/ERROR_OUT_OF_BOUNDS/ERROR_OUT_OF_MEMORY). `unsupported` (status
 * LIC_UNSUPPORTED) means the board has no license-store backend — a valid
 * device state (`success: true`), not a transport failure.
 *
 * A `success: true` here means ONLY "the bytes were accepted for storage". No
 * target validates magic, crc32, `deviceId` or `productId` on write, so a caller
 * that needs to know what the board now holds must read it back (FC 0x4A) and
 * verify — see the write path in the licensing flow.
 */
export interface DebugLicenseWriteResult {
  success: boolean
  status?: number
  unsupported?: boolean
  error?: string
}

/**
 * Result of a read-license call (FC 0x4A). `blob` is present only on SUCCESS.
 * `empty` (status LIC_EMPTY) means virgin storage — no license provisioned;
 * `corrupt` (status LIC_CORRUPT) means the magic matched but the crc32 failed.
 * `unsupported` (status LIC_UNSUPPORTED) means the board has no license-store
 * backend at all. All three are `success: true` — they are valid device
 * states, not transport failures — the caller distinguishes via the flags.
 *
 * A SUCCESS status does NOT mean the stored license is good: the two targets
 * disagree about what they check before answering it (bare metal validates magic
 * + crc32; the Linux runtime only checks the file length). Callers must verify
 * the returned bytes themselves.
 */
export interface DebugLicenseReadResult {
  success: boolean
  status?: number
  empty?: boolean
  corrupt?: boolean
  unsupported?: boolean
  blob?: Uint8Array
  error?: string
}

/**
 * Result of an MD5-probe call.  The `md5` is the runtime's program hash;
 * `targetEndian` is the byte order detected from the 2-byte sentinel the
 * runtime writes into the response trailer via a native `uint16_t*`
 * store (LE target writes `[0xAD, 0xDE]`, BE target writes `[0xDE,
 * 0xAD]`).  Renderer-side code uses `targetEndian` to drive the byte
 * swap at the debugger's read / write boundaries.
 */
export interface Md5ProbeResult {
  md5: string
  targetEndian: 'le' | 'be'
}

/**
 * Common transport interface. Every debug transport implements these methods
 * so the polling loop and session management never know which transport is active.
 *
 * This matches the desktop editor's pattern where MainProcessBridge delegates
 * to whichever client is active (ModbusTcpClient | ModbusRtuClient | WebSocketDebugClient).
 */
export interface DebugTransport {
  connect(): Promise<void>
  disconnect(): void
  getMd5Hash(): Promise<Md5ProbeResult>
  getVariablesList(indexes: number[]): Promise<DebugTransportResult>
  setVariable(index: number, force: boolean, valueBuffer?: Uint8Array): Promise<DebugSetResult>
}

/**
 * The channel-level operations every medium offers, independent of the debug
 * payload surface: open/close, the board-id read (FC 0x48) that classifies
 * whether a firmware is answering at all, and — for baremetal targets — run/stop.
 *
 * The same PDUs ride serial (ModbusRtuClient), TCP (ModbusTcpClient) and the
 * runtime-v4 debug WebSocket (WebSocketDebugTransport), so a connection is
 * established and classified identically on every target.
 */
export interface DeviceChannelTransport {
  connect(): Promise<void>
  disconnect(): void
  /** Board-id read (FC 0x48) — the readiness probe that says whether an OpenPLC
   *  firmware is answering at all. Optional for the same reason as `getStatus`:
   *  it is a BAREMETAL question. The runtime-v4 WebSocket talks to a target whose
   *  identity came from the REST login, so it never answers this. */
  getBoardId?(): Promise<DebugBoardIdResult>
  /** Runtime status (FC 0x46): run/stop state, mode-switch position, scan
   *  counter, uptime. Doubles as the liveness probe for a held link — any
   *  successful reply proves the firmware is answering — so the device liveness
   *  poll prefers it and gets the run/stop state for free.
   *
   *  Optional because run/stop is a BAREMETAL concern: the Modbus RTU/TCP
   *  clients implement it, while the runtime-v4 WebSocket transport does not —
   *  v4 drives run/stop over its REST API, so implementing it there would be
   *  dead code. */
  getStatus?(): Promise<DebugStatusResult>
  /** Run/stop command (FC 0x4b). Reads go through `getStatus()`. Optional for
   *  the same reason as `getStatus`. */
  setPlcState?(state: PlcRuntimeState.RUNNING | PlcRuntimeState.STOPPED): Promise<PlcControlResult>
  /** Read the stored VPP license blob (FC 0x4A). Optional here because not every
   *  medium carries it — but unlike run/stop, every medium that CAN is expected
   *  to: licensing is a property of the device, not of the target family, so the
   *  Modbus clients and the runtime-v4 WebSocket all implement it (see
   *  `DeviceModbusTransport`, where it is required). */
  readLicense?(): Promise<DebugLicenseReadResult>
  /** Store a VPP license blob (FC 0x49). Optional for the same reason as
   *  `readLicense`. Storing does not validate — read back to confirm. */
  writeLicense?(blob: Uint8Array): Promise<DebugLicenseWriteResult>
}

/**
 * What a DEBUG channel must offer, whatever medium it runs over: the channel
 * operations plus the debug payload surface.
 *
 * Deliberately narrower than `DeviceModbusTransport`: it does NOT require
 * `getStatus` / `setPlcState`, because those are CONTROL operations and a debug
 * channel is not always the control channel. The runtime-v4 WebSocket implements
 * exactly this and nothing more — v4 is controlled over REST.
 */
export interface DeviceDebugChannel extends DeviceChannelTransport {
  getMd5Hash(): Promise<Md5ProbeResult>
  getVariablesList(indexes: number[]): Promise<{
    success: boolean
    tick?: number
    lastIndex?: number
    /** `Buffer | Uint8Array`: the Node Modbus clients hand back the former, the
     *  browser-shared WebSocket transport the latter, and TypeScript does not
     *  treat one as a substitute for the other. */
    data?: Uint8Array | Buffer
    error?: string
  }>
  setVariable(index: number, force: boolean, valueBuffer?: Uint8Array | Buffer): Promise<DebugSetResult>
  /**
   * Resolves once `disconnect()` has released this channel's native handle.
   *
   * Optional because only transports WITH a native handle have anything to wait
   * for — the WebSocket and the simulator are not obliged to implement a no-op.
   * Declared here rather than probed reflectively so the one call the SIGABRT fix
   * depends on is typechecked: renaming `ModbusRtuClient.closed` used to fall
   * back silently to a zero-length wait, which is precisely the bug it guards.
   */
  closed?(): Promise<void>
}

/**
 * The full command surface of a Modbus link to a device: the debug operations
 * (`DebugTransport`) plus the channel operations (`DeviceChannelTransport`)
 * plus run/stop.
 *
 * `ModbusRtuClient` and `ModbusTcpClient` are separate classes that differ only
 * in framing (RTU: slave id + CRC; TCP: MBAP header). The PDUs they carry, and
 * therefore the operations they expose, are identical. Naming that shared
 * surface is what lets ONE held connection serve every caller regardless of how
 * it was established, instead of each caller picking a client class and opening
 * its own connection.
 *
 * A caller-by-caller choice is exactly what broke run/stop over Modbus TCP: the
 * command path recognised only RTU clients as reusable, so with a live TCP link
 * it opened a second socket — which an Arduino Modbus TCP server, serving one
 * client at a time, never answered.
 *
 * `getStatus` / `setPlcState` are REQUIRED here, narrowing the optionals on
 * `DeviceChannelTransport`: both Modbus clients implement run/stop, and only the
 * runtime-v4 WebSocket (a different protocol, driving run/stop over REST) does
 * not.
 *
 * `readLicense` / `writeLicense` are required for a different reason: the license
 * FCs are transport-agnostic by design, so device activation runs identically on
 * serial and on TCP. A Modbus link that could not carry them would give the
 * licensing flow a second, target-dependent shape — which is the divergence the
 * one-transport-interface refactor exists to prevent.
 */
export interface DeviceModbusTransport
  extends Omit<DebugTransport, 'getVariablesList' | 'setVariable'>,
    DeviceChannelTransport {
  getBoardId(): Promise<DebugBoardIdResult>
  getStatus(): Promise<DebugStatusResult>
  setPlcState(state: PlcRuntimeState.RUNNING | PlcRuntimeState.STOPPED): Promise<PlcControlResult>
  readLicense(): Promise<DebugLicenseReadResult>
  writeLicense(blob: Uint8Array): Promise<DebugLicenseWriteResult>
  /**
   * The two payload-carrying operations, restated for the main process.
   *
   * `DebugTransport` types payloads as `Uint8Array` because it is also
   * implemented in the browser-shared layer; the Node Modbus clients hand back
   * `Buffer`, which TypeScript does not treat as a substitute for `Uint8Array`
   * since @types/node made `Buffer` generic. Everything else — connect,
   * disconnect, getMd5Hash — is inherited unchanged.
   */
  getVariablesList(indexes: number[]): Promise<{
    success: boolean
    tick?: number
    lastIndex?: number
    data?: Buffer
    error?: string
  }>
  setVariable(index: number, force: boolean, valueBuffer?: Buffer): Promise<DebugSetResult>
}

/**
 * Result of a run/stop command (FC 0x4b `PLC_SET_STATE`).
 *
 * Reads are NOT done through this — they come from `DebugStatusResult` via
 * FC 0x46. This is the command's acknowledgement, which carries the resulting
 * state so a caller can react without waiting for the next poll.
 */
export interface PlcControlResult {
  success: boolean
  /** State as of the target's last scan cycle. The runtime derives the new
   *  state inside its next cycle, so a caller that needs the settled value
   *  reads it from the next status poll (at most one scan period later). */
  state?: number
  switchPosition?: number
  /** A RUN request was refused because the switch reads STOP. Drives the
   *  "flip the switch to RUN" warning. */
  refusedBySwitch?: boolean
  /** Firmware predates the run/stop state machine. Drives an informational
   *  "rebuild and upload" message instead of an error. */
  unsupported?: boolean
  error?: string
}
