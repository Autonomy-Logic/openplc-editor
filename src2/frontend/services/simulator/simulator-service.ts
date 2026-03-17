/**
 * Simulator Service Facade
 *
 * Provides a singleton with the same API as the web's SimulatorService,
 * but delegates all operations to a registered SimulatorPort instance.
 *
 * This allows byte-identical frontend code to call simulatorService methods
 * while the actual implementation differs per platform:
 * - Editor: SimulatorPort delegates to main process via IPC
 * - Web: SimulatorPort wraps in-process avr8js emulator
 */

import type { SimulatorPort } from '../../../middleware/shared/ports/simulator-port'

type StopCallback = () => void

class SimulatorServiceFacade {
  private port: SimulatorPort | null = null
  private stopCallbacks: StopCallback[] = []
  private unsubscribeFromPort: (() => void) | null = null

  /**
   * Register the platform-specific SimulatorPort.
   * Called once at app startup from the composition root.
   */
  register(port: SimulatorPort): void {
    // Unsubscribe from previous port if any
    if (this.unsubscribeFromPort) {
      this.unsubscribeFromPort()
    }
    this.port = port
    // Forward stop events from the port to our callbacks
    this.unsubscribeFromPort = port.onStopped(() => {
      for (const cb of this.stopCallbacks) {
        cb()
      }
    })
  }

  /**
   * Check if the simulator is currently running.
   */
  isRunning(): boolean {
    return this.port?.isRunning() ?? false
  }

  /**
   * Stop the simulator.
   */
  stop(): void {
    if (this.port) {
      void this.port.stop()
    }
  }

  /**
   * Connect the debugger to the running simulator.
   */
  async connectDebugger(): Promise<void> {
    if (!this.port) throw new Error('SimulatorPort not registered')
    await this.port.connectDebugger()
  }

  /**
   * Disconnect the debugger from the simulator.
   */
  disconnectDebugger(): void {
    this.port?.disconnectDebugger()
  }

  /**
   * Get the MD5 hash from the running firmware.
   */
  async getMd5Hash(): Promise<string> {
    if (!this.port) throw new Error('SimulatorPort not registered')
    return this.port.getDebugMd5Hash()
  }

  /**
   * Get variable values from the simulator.
   * Returns data as a hex string for compatibility with handleValuesResponse.
   */
  async getVariablesList(indexes: number[]): Promise<{
    success: boolean
    tick?: number
    lastIndex?: number
    data?: string
    error?: string
  }> {
    if (!this.port) return { success: false, error: 'SimulatorPort not registered' }
    return this.port.getDebugVariablesList(indexes)
  }

  /**
   * Force or release a variable in the simulator.
   */
  async setVariable(index: number, force: boolean, valueHex?: string): Promise<{ success: boolean; error?: string }> {
    if (!this.port) return { success: false, error: 'SimulatorPort not registered' }
    return this.port.setDebugVariable(index, force, valueHex)
  }

  /**
   * Subscribe to simulator stop events. Returns an unsubscribe function.
   */
  onStopped(callback: StopCallback): () => void {
    this.stopCallbacks.push(callback)
    return () => {
      this.stopCallbacks = this.stopCallbacks.filter((cb) => cb !== callback)
    }
  }
}

/** Singleton instance */
export const simulatorService = new SimulatorServiceFacade()
