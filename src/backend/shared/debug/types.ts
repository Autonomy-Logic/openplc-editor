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
 * WHY THERE ARE TWO OF THESE AND NOT ONE (DOPE-589). FC 0x48 answers a
 * different KIND of value depending on the platform, and one shared type would
 * make the field name a lie on one of them:
 *
 *   - bare metal answers the DERIVED device_id. The closed license-core reads
 *     the silicon and derives it internally (`license_gate_device_id`), so the
 *     raw factory serial never leaves the artifact and the open firmware links
 *     no unique-id library at all;
 *   - runtime-v4 answers the RAW anchor, its device-tree serial, and the
 *     editor derives the device_id from it in TypeScript.
 *
 * The licensing flow takes the union (`DeviceIdentity` in license-flow.ts) so
 * the compiler makes every caller say which one it holds. Collapsing them back
 * into one field is how a derived id gets hashed a second time, or a raw serial
 * gets published as an identity.
 *
 * `unsupported` (status LIC_UNSUPPORTED, 0x85) means the target answered that
 * it has NO identity to license against - a runtime-v4 host with no
 * device-tree serial (x86 box, container). Distinct from a transport failure on
 * purpose: the licensing flow maps it to the terminal `unsupported` outcome
 * (no retry nag) instead of an endlessly retryable check-failed.
 */

/**
 * Bare-metal identity read (FC 0x48). `deviceId` is the 16-byte derived
 * device_id, or EMPTY when the board has no identity a licence can be bound to
 * (no license-core linked, or an architecture the closed reader refuses).
 *
 * An empty id is a SUCCESS reply and must stay one: `device-probe` reads the
 * successful reply, not the bytes, as proof that firmware is running.
 */
export interface DebugDeviceIdResult {
  success: boolean
  unsupported?: boolean
  deviceId?: Uint8Array
  deviceIdHex?: string
  error?: string
}

/**
 * runtime-v4 identity read (FC 0x48 over the debug WebSocket). `anchor` is the
 * device-tree serial with its trailing NUL/LF/CR/space already stripped, which
 * is the same normalization the closed core applies on read - the editor must
 * hash exactly what the device hashes.
 */
export interface DebugAnchorResult {
  success: boolean
  unsupported?: boolean
  anchor?: Uint8Array
  anchorHex?: string
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
  /** Identity read (FC 0x48), one function code with two medium-specific
   *  meanings, hence two methods (DOPE-589).
   *
   *  `getDeviceId` is the BAREMETAL read: the closed license-core derives the
   *  device_id inside the artifact and the firmware reports it, so nothing on
   *  this side hashes anything. It doubles as the readiness probe that says
   *  whether an OpenPLC firmware is answering at all - which is why a
   *  SUCCESSFUL reply matters and an empty id does not fail it.
   *
   *  `getAnchor` is the RUNTIME-V4 read: the runtime answers 0x48 at the
   *  webserver level with the raw device-tree anchor and the editor derives the
   *  device_id from it. Readiness on a runtime target stays a REST question.
   *
   *  Both optional: a medium that carries neither role omits both, and no
   *  medium implements both. */
  getDeviceId?(): Promise<DebugDeviceIdResult>
  getAnchor?(): Promise<DebugAnchorResult>
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
  /** Hand the channel a fresh auth token mid-session. Only media that
   *  authenticate per command need it — the runtime-v4 WebSocket, whose server
   *  re-verifies the JWT on every debug_command (openplc-runtime#169): without
   *  renewal a held debug session dies when the login-time token expires
   *  (~15 min). Fire-and-forget: the server acks via its own event. */
  reauth?(token: string): void
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
  getDeviceId(): Promise<DebugDeviceIdResult>
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
