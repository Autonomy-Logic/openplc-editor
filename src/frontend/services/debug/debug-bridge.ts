/**
 * Debug Bridge — singleton orchestrator for debug transport management.
 *
 * Mirrors the debugger-related fields and methods of the desktop editor's
 * MainProcessBridge (src/main/modules/ipc/main.ts). The polling loop and
 * session management call debugBridge methods — they never know which
 * transport is active.
 *
 * Equivalent to `window.bridge.debugger*()` calls in the desktop editor.
 */

import type { DebugConnectionType, DebugSetResult, DebugTransport, DebugTransportResult } from './types'

type StopCallback = () => void

class DebugBridge {
  private activeTransport: DebugTransport | null = null
  private connectionType: DebugConnectionType | null = null
  private stopCallbacks: StopCallback[] = []

  /**
   * Set the active transport. Called when starting a debug session.
   * Any previous transport is disconnected first.
   */
  setTransport(type: DebugConnectionType, transport: DebugTransport): void {
    if (this.activeTransport) {
      this.activeTransport.disconnect()
    }
    this.connectionType = type
    this.activeTransport = transport
  }

  /**
   * Clear the active transport without disconnecting it.
   * Used when the transport was already disconnected externally.
   */
  clearTransport(): void {
    this.connectionType = null
    this.activeTransport = null
  }

  /**
   * Get the current connection type (null if no active session).
   */
  getConnectionType(): DebugConnectionType | null {
    return this.connectionType
  }

  /**
   * Check if a transport is currently active.
   */
  isConnected(): boolean {
    return this.activeTransport !== null
  }

  /**
   * Connect the active transport.
   * Caller must call setTransport() first.
   */
  async connect(): Promise<void> {
    if (!this.activeTransport) {
      throw new Error('No transport set')
    }
    await this.activeTransport.connect()
  }

  /**
   * Disconnect the active transport and clear state.
   * Mirrors handleDebuggerDisconnect in the desktop editor.
   */
  disconnect(): void {
    if (this.activeTransport) {
      this.activeTransport.disconnect()
    }
    this.activeTransport = null
    this.connectionType = null

    for (const cb of this.stopCallbacks) {
      cb()
    }
  }

  /**
   * Verify the MD5 hash of the running firmware.
   * Mirrors handleDebuggerVerifyMd5 in the desktop editor.
   */
  async verifyMd5(
    expectedMd5: string,
  ): Promise<{ success: boolean; match?: boolean; targetMd5?: string; error?: string }> {
    if (!this.activeTransport) {
      return { success: false, error: 'No transport connected' }
    }

    try {
      const targetMd5 = await this.activeTransport.getMd5Hash()
      const match = targetMd5.toLowerCase() === expectedMd5.toLowerCase()
      return { success: true, match, targetMd5 }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during MD5 verification',
      }
    }
  }

  /**
   * Poll variable values from the runtime.
   * Mirrors handleDebuggerGetVariablesList in the desktop editor.
   */
  async getVariablesList(indexes: number[]): Promise<DebugTransportResult> {
    if (!this.activeTransport) {
      return { success: false, error: 'No transport connected' }
    }

    return this.activeTransport.getVariablesList(indexes)
  }

  /**
   * Force or release a variable in the runtime.
   * Mirrors handleDebuggerSetVariable in the desktop editor.
   */
  async setVariable(index: number, force: boolean, valueBuffer?: Uint8Array): Promise<DebugSetResult> {
    if (!this.activeTransport) {
      return { success: false, error: 'No transport connected' }
    }

    return this.activeTransport.setVariable(index, force, valueBuffer)
  }

  /**
   * Subscribe to debug session stop events. Returns an unsubscribe function.
   */
  onStopped(callback: StopCallback): () => void {
    this.stopCallbacks.push(callback)
    return () => {
      this.stopCallbacks = this.stopCallbacks.filter((cb) => cb !== callback)
    }
  }
}

/** Singleton instance — the single source of truth for the active debug connection. */
export const debugBridge = new DebugBridge()
