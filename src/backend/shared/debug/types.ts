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
 * Result of an FC 0x49 run/stop query or command (baremetal targets).
 *
 * The same shape is used for Runtime v4, whose REST surface carries the
 * equivalent fields (`status` + `switchPosition`), so the editor's PLC-control
 * UI has one result type regardless of target.
 */
export interface PlcControlResult {
  success: boolean
  /** Runtime state as of the target's last scan cycle. On a SET_STATE the
   *  runtime derives the new state inside its next cycle, so the caller sees it
   *  on the following poll (at most one scan period later). */
  state?: number
  /** Mode-switch position: 0 = STOP, 1 = RUN. Boards with no physical switch
   *  always report RUN, so callers need no "absent" case. */
  switchPosition?: number
  /** A RUN request was refused because the switch reads STOP. Drives the
   *  "flip the switch to RUN" warning. */
  refusedBySwitch?: boolean
  /** Firmware predates FC 0x49. Drives an informational "rebuild and upload"
   *  message instead of an error. */
  unsupported?: boolean
  error?: string
}
