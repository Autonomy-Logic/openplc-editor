/**
 * SimulatorPort — Abstracts the built-in AVR simulator (ATmega2560 via avr8js).
 *
 * Editor adapter: Delegates to main process SimulatorModule via IPC.
 *                 Firmware loaded from disk path. USART0 bridged to ModbusRtuClient.
 * Web adapter:    Delegates to in-browser SimulatorService singleton.
 *                 Firmware loaded from hex string content (from compiler API).
 *                 Uses browser-compatible Uint8Array-based Modbus RTU client.
 *
 * Both adapters share the same underlying avr8js@0.20.0 emulator, but differ
 * in how firmware is loaded and how the virtual serial port is bridged.
 *
 * ## Editor IPC methods replaced:
 *   - window.bridge.simulatorLoadFirmware(hexPath)
 *   - window.bridge.simulatorStop()
 *   - window.bridge.simulatorIsRunning()
 *   - window.bridge.onSimulatorStopped()
 *
 * ## Web service methods replaced:
 *   - simulatorService.loadAndRun(hexContent)
 *   - simulatorService.stop()
 *   - simulatorService.isRunning()
 *   - simulatorService.onStopped()
 *   - simulatorService.connectDebugger()
 *   - simulatorService.disconnectDebugger()
 */

import type { SimulatorDebugResult, Unsubscribe } from './types'

export interface SimulatorPort {
  /**
   * Load firmware and start the simulator.
   * Editor: receives a file path to the .hex file on disk.
   * Web: receives the hex content as a string.
   * The adapter handles the difference.
   */
  loadFirmware(hexPathOrContent: string): Promise<{ success: boolean; error?: string }>

  /** Stop the simulator. */
  stop(): Promise<{ success: boolean }>

  /** Check if the simulator is currently running. */
  isRunning(): boolean

  /**
   * Subscribe to simulator stop events (crash, user stop, or program exit).
   * Returns unsubscribe function.
   */
  onStopped(callback: () => void): Unsubscribe

  /**
   * Connect the debugger to the running simulator.
   * Web adapter: initializes virtual serial port and Modbus RTU client.
   * Editor adapter: already connected via main process; this is a no-op or
   *                 triggers debuggerConnect with 'simulator' type.
   */
  connectDebugger(): Promise<void>

  /**
   * Disconnect the debugger from the simulator.
   * Cleans up virtual serial port and Modbus client state.
   */
  disconnectDebugger(): void

  /**
   * Get the MD5 hash from the running firmware (used for program verification).
   * Only available when debugger is connected.
   */
  getDebugMd5Hash(): Promise<string>

  /**
   * Get variable values from the simulator via debug protocol.
   * Returns data as a hex string for compatibility with handleValuesResponse.
   */
  getDebugVariablesList(indexes: number[]): Promise<SimulatorDebugResult>

  /**
   * Force or release a variable in the simulator via debug protocol.
   * Accepts valueHex as a hex string.
   */
  setDebugVariable(index: number, force: boolean, valueHex?: string): Promise<{ success: boolean; error?: string }>
}
