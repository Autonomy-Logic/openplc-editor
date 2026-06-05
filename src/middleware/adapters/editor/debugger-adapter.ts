/**
 * Editor DebuggerPort adapter — delegates to Electron IPC bridge.
 *
 * Communicates with the main process debugger handlers via window.bridge.debugger*
 * methods. The main process manages Modbus clients (TCP, RTU, WebSocket) and the
 * simulator virtual serial port.
 *
 * Connection config is passed per-call via the DebugConnectionConfig parameter.
 * The main process persists the Modbus/WebSocket client between calls and handles
 * auto-reconnection using stored connection parameters.
 */

import { getErrorMessage } from '../../../frontend/utils/get-error-message'
import type { DebuggerPort } from '../../shared/ports/debugger-port'
import type {
  DebugConnectionConfig,
  DebugSetResult,
  DebugVariableResult,
  Md5VerifyResult,
  Unsubscribe,
} from '../../shared/ports/types'

export function createEditorDebuggerAdapter(): DebuggerPort {
  let connected = false
  const disconnectCallbacks: Array<() => void> = []

  return {
    async connect(config: DebugConnectionConfig): Promise<{ success: boolean; error?: string }> {
      try {
        const result = await window.bridge.debuggerConnect(config.connectionType, config.connectionParams)
        if (result.success) connected = true
        return result
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    async disconnect(): Promise<{ success: boolean }> {
      try {
        const result = await window.bridge.debuggerDisconnect()
        connected = false
        for (const cb of disconnectCallbacks) cb()
        return result
      } catch {
        connected = false
        for (const cb of disconnectCallbacks) cb()
        return { success: true }
      }
    },

    async getVariablesList(indexes: number[]): Promise<DebugVariableResult> {
      try {
        return await window.bridge.debuggerGetVariablesList(indexes)
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    async setVariable(index: number, force: boolean, valueBuffer?: Uint8Array): Promise<DebugSetResult> {
      try {
        return await window.bridge.debuggerSetVariable(index, force, valueBuffer)
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    async verifyMd5(expectedMd5: string, config: DebugConnectionConfig): Promise<Md5VerifyResult> {
      try {
        return await window.bridge.debuggerVerifyMd5(config.connectionType, config.connectionParams, expectedMd5)
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    async readProgramMd5(
      projectPath: string,
      boardTarget: string,
    ): Promise<{ success: boolean; md5?: string; error?: string }> {
      try {
        return await window.bridge.debuggerReadProgramStMd5(projectPath, boardTarget)
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    async readDebugFile(
      projectPath: string,
      boardTarget: string,
    ): Promise<{ success: boolean; content?: string; error?: string }> {
      try {
        return await window.bridge.readDebugFile(projectPath, boardTarget)
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    onDisconnected(callback: () => void): Unsubscribe {
      disconnectCallbacks.push(callback)
      return () => {
        const idx = disconnectCallbacks.indexOf(callback)
        if (idx >= 0) disconnectCallbacks.splice(idx, 1)
      }
    },

    isConnected(): boolean {
      return connected
    },
  }
}
