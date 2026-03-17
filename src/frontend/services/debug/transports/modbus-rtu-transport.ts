/**
 * Modbus RTU Transport — simulator debug transport.
 *
 * Thin adapter that wraps the existing SimulatorService + ModbusRtuClient
 * to implement the DebugTransport interface. Used when the simulator board
 * is selected (connection type = 'simulator').
 *
 * Mirrors the desktop editor's pattern where the simulator creates a
 * VirtualSerialPort + ModbusRtuClient pair (MainProcessBridge lines 894-909).
 */

import { bytesToHex, hexToBytes } from '../../../utils/hex'
import { simulatorService } from '../../simulator'
import type { DebugSetResult, DebugTransport, DebugTransportResult } from '../types'

export class ModbusRtuTransport implements DebugTransport {
  async connect(): Promise<void> {
    await simulatorService.connectDebugger()
  }

  disconnect(): void {
    simulatorService.disconnectDebugger()
  }

  async getMd5Hash(): Promise<string> {
    return simulatorService.getMd5Hash()
  }

  async getVariablesList(indexes: number[]): Promise<DebugTransportResult> {
    if (!simulatorService.isRunning()) {
      return { success: false, error: 'Simulator is not running' }
    }

    const result = await simulatorService.getVariablesList(indexes)

    if (!result.success) {
      return { success: false, error: result.error }
    }

    return {
      success: true,
      tick: result.tick,
      lastIndex: result.lastIndex,
      data: result.data ? hexToBytes(result.data) : undefined,
    }
  }

  async setVariable(index: number, force: boolean, valueBuffer?: Uint8Array): Promise<DebugSetResult> {
    const valueHex = force && valueBuffer ? bytesToHex(valueBuffer) : undefined
    return simulatorService.setVariable(index, force, valueHex)
  }
}
