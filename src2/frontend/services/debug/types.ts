/**
 * Debug Transport Interface
 *
 * Defines the duck-typed contract that all debug transports must implement.
 * Mirrors the implicit interface from openplc-editor where ModbusTcpClient,
 * ModbusRtuClient, and WebSocketDebugClient all implement the same methods.
 *
 * openplc-web transports: ModbusRtuTransport (simulator), WebRTCTransport, HttpTransport.
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
 * Common transport interface. Every debug transport implements these methods
 * so the polling loop and session management never know which transport is active.
 *
 * This matches the desktop editor's pattern where MainProcessBridge delegates
 * to whichever client is active (ModbusTcpClient | ModbusRtuClient | WebSocketDebugClient).
 */
export interface DebugTransport {
  connect(): Promise<void>
  disconnect(): void
  getMd5Hash(): Promise<string>
  getVariablesList(indexes: number[]): Promise<DebugTransportResult>
  setVariable(index: number, force: boolean, valueBuffer?: Uint8Array): Promise<DebugSetResult>
}
