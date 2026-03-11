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

import type { SimulatorPort } from '../../shared/ports/simulator-port'
import type { Unsubscribe } from '../../shared/ports/types'

export function createEditorSimulatorAdapter(): SimulatorPort {
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
        return { success: false, error: err instanceof Error ? err.message : String(err) }
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
  }
}
