/**
 * Debug Transport Interface
 *
 * Defines the duck-typed contract that all debug transports must implement.
 * Mirrors the implicit interface from openplc-editor where ModbusTcpClient,
 * ModbusRtuClient, and WebSocketDebugClient all implement the same methods.
 *
 * openplc-web transports: ModbusRtuTransport (simulator), ModbusDataChannelTransport (WebRTC), HttpTransport.
 */

export type DebugConnectionType = 'webrtc' | 'http' | 'simulator'

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
 * The license function codes (0x48 board-id / 0x49 write / 0x4A read) as a
 * transport-agnostic contract. The same PDU rides serial (ModbusRtuClient),
 * TCP (ModbusTcpClient) and the runtime-v4 debug WebSocket
 * (WebSocketDebugTransport) — so device activation runs identically on every
 * target (D70c). connect/disconnect are shared with the debug session.
 */
export interface LicenseCapableTransport {
  connect(): Promise<void>
  disconnect(): void
  getBoardId(): Promise<DebugBoardIdResult>
  readLicense(): Promise<DebugLicenseReadResult>
  writeLicense(blob: Uint8Array): Promise<DebugLicenseWriteResult>
}
