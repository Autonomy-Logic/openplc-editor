/**
 * SimulatorPort — the OpenPLC Simulator: the project compiled to a WebAssembly module, run with simulated time, and
 * debugged over its virtual serial line with the same Modbus RTU protocol as a board.
 *
 * Both platforms run the shared simulator (`backend/shared/simulator/`) in a thread of its own:
 * - Editor: the main process runs each run in a worker thread; the debugger's Modbus client lives in the main process.
 * - Web: a Web Worker runs the module; the debug session lives on the page.
 */

import type { SimulatorDebugResult, Unsubscribe } from './types'

export interface SimulatorPort {
  /**
   * Starts the simulator with the build's module; resolves once its `setup()` ran.
   * Editor: the module's path on disk. Web: the module as text, one character per byte (`encodeSimulatorFirmware`).
   */
  loadFirmware(firmware: string): Promise<{ success: boolean; error?: string }>

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
