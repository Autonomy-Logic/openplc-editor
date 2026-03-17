/**
 * Editor SimulatorPort adapter — delegates to Electron IPC bridge.
 *
 * The main process runs the avr8js ATmega2560 emulator as a singleton.
 * Firmware is loaded from a .hex file path on disk. The virtual serial port
 * and ModbusRtuClient are managed internally by the main process.
 *
 * Running state is tracked locally for synchronous access (the IPC bridge
 * method returns a Promise, but the port contract requires a sync boolean).
 *
 * connectDebugger/disconnectDebugger are no-ops: the main process automatically
 * wires the VirtualSerialPort when debuggerConnect is called with 'simulator' type.
 */

import { getErrorMessage } from '../../../frontend/utils/get-error-message'
import type { SimulatorPort } from '../../shared/ports/simulator-port'
import type { SimulatorDebugResult, Unsubscribe } from '../../shared/ports/types'

export function createEditorSimulatorAdapter(
  getProjectContext?: () => { projectPath: string; boardTarget: string },
): SimulatorPort {
  let running = false
  const stopCallbacks: Array<() => void> = []

  // Subscribe to main process simulator stop events once on creation
  const unsubscribeFromMain = window.bridge.onSimulatorStopped(() => {
    running = false
    for (const cb of stopCallbacks) cb()
  })

  // Keep the unsubscribe reference to allow cleanup if needed
  void unsubscribeFromMain

  return {
    async loadFirmware(hexPath: string): Promise<{ success: boolean; error?: string }> {
      try {
        const result = await window.bridge.simulatorLoadFirmware(hexPath)
        if (result.success) running = true
        return result
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    async stop(): Promise<{ success: boolean }> {
      try {
        const result = await window.bridge.simulatorStop()
        running = false
        for (const cb of stopCallbacks) cb()
        return result
      } catch {
        running = false
        for (const cb of stopCallbacks) cb()
        return { success: true }
      }
    },

    isRunning(): boolean {
      return running
    },

    onStopped(callback: () => void): Unsubscribe {
      stopCallbacks.push(callback)
      return () => {
        const idx = stopCallbacks.indexOf(callback)
        if (idx >= 0) stopCallbacks.splice(idx, 1)
      }
    },

    async connectDebugger(): Promise<void> {
      // No-op for editor: the main process wires the VirtualSerialPort
      // when debuggerConnect is called with 'simulator' connection type.
    },

    disconnectDebugger(): void {
      // No-op for editor: cleanup is handled by the main process
      // when debuggerDisconnect is called.
    },

    async getDebugMd5Hash(): Promise<string> {
      if (!getProjectContext) {
        throw new Error('Project context not available for MD5 hash')
      }
      const { projectPath, boardTarget } = getProjectContext()
      const result = await window.bridge.debuggerReadProgramStMd5(projectPath, boardTarget)
      if (!result.success || !result.md5) {
        throw new Error(result.error ?? 'Failed to read MD5 hash')
      }
      return result.md5
    },

    async getDebugVariablesList(indexes: number[]): Promise<SimulatorDebugResult> {
      const result = await window.bridge.debuggerGetVariablesList(indexes)
      if (!result.success) {
        return { success: false, error: result.error }
      }
      // Convert number[] data to hex string
      let hexData: string | undefined
      if (result.data) {
        hexData = result.data.map((b: number) => b.toString(16).padStart(2, '0')).join('')
      }
      return {
        success: true,
        tick: result.tick,
        lastIndex: result.lastIndex,
        data: hexData,
      }
    },

    async setDebugVariable(
      index: number,
      force: boolean,
      valueHex?: string,
    ): Promise<{ success: boolean; error?: string }> {
      // Convert hex string back to number[] for the IPC bridge
      let valueBuffer: number[] | undefined
      if (force && valueHex) {
        const hexClean = valueHex.replace(/\s+/g, '')
        valueBuffer = []
        for (let i = 0; i < hexClean.length; i += 2) {
          valueBuffer.push(parseInt(hexClean.substring(i, i + 2), 16))
        }
      }
      return window.bridge.debuggerSetVariable(index, force, valueBuffer ? new Uint8Array(valueBuffer) : undefined)
    },
  }
}
