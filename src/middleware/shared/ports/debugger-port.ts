/**
 * DebuggerPort — Abstracts the debug protocol for reading/writing PLC variables.
 *
 * Editor adapter: Routes through IPC to main process Modbus clients
 *                 (TCP, RTU, WebSocket, or simulator virtual serial port).
 * Web adapter:    Routes through DebugBridge singleton which delegates to
 *                 WebRTCTransport, ModbusRtuTransport (simulator), or HTTP fallback.
 *
 * The underlying protocol is always Modbus PDU with custom function codes
 * (0x41-0x45) for debug operations. The port hides transport specifics.
 *
 * ## Editor IPC methods replaced:
 *   - window.bridge.debuggerConnect()
 *   - window.bridge.debuggerDisconnect()
 *   - window.bridge.debuggerGetVariablesList()
 *   - window.bridge.debuggerSetVariable()
 *   - window.bridge.debuggerVerifyMd5()
 *   - window.bridge.debuggerReadProgramStMd5()
 *   - window.bridge.readDebugFile()
 *
 * ## Web service methods replaced:
 *   - debugBridge.connect()
 *   - debugBridge.disconnect()
 *   - debugBridge.getVariablesList()
 *   - debugBridge.setVariable()
 *   - debugBridge.verifyMd5()
 *   - debugBridge.onStopped()
 *   - DebugTransport interface implementations
 */

import type { PlcControlResult } from '../../../backend/shared/debug/types'
import type {
  DebugConnectionConfig,
  DebugLicenseReadResult,
  DebugLicenseWriteResult,
  DebugSetResult,
  DebugVariableResult,
  Md5VerifyResult,
  Unsubscribe,
} from './types'

export interface DebuggerPort {
  /**
   * Start a debug session.
   *
   * `config` describes a target the connection manager does not hold a session
   * for yet — a Runtime v3/v4 or the simulator. Omit it for a target that IS
   * connected (a baremetal board): the session already knows its medium, and
   * naming one here is how a Stop over serial came to ask for a DHCP address.
   */
  connect(config?: DebugConnectionConfig): Promise<{ success: boolean; error?: string }>

  /** Disconnect from the current debug target. */
  disconnect(): Promise<{ success: boolean }>

  /**
   * Read variable values by their debug indexes (batched).
   * Returns tick count, last index processed, and raw data array.
   * `needsReconnect` signals the UI to re-establish the connection.
   */
  getVariablesList(indexes: number[]): Promise<DebugVariableResult>

  /**
   * Write or force a variable value.
   * @param index — Variable debug index
   * @param force — If true, the value is forced (overrides PLC logic)
   * @param valueBuffer — Raw value bytes (Uint8Array)
   */
  setVariable(index: number, force: boolean, valueBuffer?: Uint8Array): Promise<DebugSetResult>

  /**
   * Write a license blob to the target's on-device storage (FC 0x49).
   * @param blob — Raw license blob bytes (little-endian struct; see license-blob).
   */
  writeLicense(blob: Uint8Array): Promise<DebugLicenseWriteResult>

  /**
   * Read the license blob from the target's on-device storage (FC 0x4A).
   * Returns `{ empty: true }` for virgin storage and `{ corrupt: true }` when
   * the magic matched but the crc32 failed — both with `success: true`.
   */
  readLicense(): Promise<DebugLicenseReadResult>

  
  /**
   * Verify that the running program matches the expected MD5 hash.
   * Used to detect program mismatch before starting a debug session.
   * @param config — Connection target used for the verification request.
   */
  verifyMd5(expectedMd5: string, config?: DebugConnectionConfig): Promise<Md5VerifyResult>

  /**
   * Read the MD5 hash of the compiled ST program from the debug artifacts.
   * Editor: reads from disk via IPC.
   * Web: reads from compiler API response or cached artifacts.
   */
  readProgramMd5(projectPath: string, boardTarget: string): Promise<{ success: boolean; md5?: string; error?: string }>

  /**
   * Read the debug file content (variable mapping produced by compiler).
   * Editor: reads .dbg file from disk.
   * Web: reads from compiler API response.
   */
  readDebugFile(
    projectPath: string,
    boardTarget: string,
  ): Promise<{ success: boolean; content?: string; error?: string }>

  /**
   * Subscribe to debugger disconnection events (e.g., simulator stopped, connection lost).
   * Returns unsubscribe function.
   */
  onDisconnected(callback: () => void): Unsubscribe

  /**
   * Ask the target to run or stop (Modbus FC 0x4b).
   *
   * Command only — the state is READ from the device status poll (FC 0x46),
   * which already reports it, so there is deliberately no `getPlcState` here.
   *
   * A RUN request is REFUSED, not queued, while the hardware mode switch reads
   * STOP; the result carries `refusedBySwitch` so the caller shows the "flip the
   * switch to RUN" warning. `unsupported` means the firmware predates the
   * run/stop state machine.
   */
  setPlcState?(state: 'RUNNING' | 'STOPPED'): Promise<PlcControlResult>

  /** Check if the debugger is currently connected. */
  isConnected(): boolean
}
