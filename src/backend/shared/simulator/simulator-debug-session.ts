import type { SimulatorDebugResult } from '../../../middleware/shared/ports/types'
import { ModbusRtuClient } from './modbus-rtu-client'
import { VirtualSerialPort } from './virtual-serial-port'
import { type SimulatorLogStream, type UartSimulator, WasmSimulatorModule } from './wasm-simulator-module'

/** A simulator run, in this thread (`WasmSimulatorModule`) or in its own (`ThreadedSimulator`). */
export interface SimulatorRunner extends UartSimulator {
  onLog: ((line: string, stream: SimulatorLogStream) => void) | null
  onStopped: ((reason: string) => void) | null
  loadAndRun(module: Uint8Array): Promise<void>
  stop(): void
  isRunning(): boolean
}

/** The debugger's Modbus address in the simulator, fixed by its `defines.h` (`MBSERIAL_SLAVE`). */
const MODBUS_SLAVE_ID = 1
const MODBUS_TIMEOUT_MS = 5000

const toHex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, '')
  const bytes = new Uint8Array(clean.length / 2)
  for (let n = 0; n < bytes.length; n++) bytes[n] = parseInt(clean.substring(n * 2, n * 2 + 2), 16)
  return bytes
}

/** The build's module as the text the web carries in `firmwarePath`: one character per byte. */
export function encodeSimulatorFirmware(module: Uint8Array): string {
  let text = ''
  for (const byte of module) text += String.fromCharCode(byte)
  return text
}

export function decodeSimulatorFirmware(text: string): Uint8Array {
  const module = new Uint8Array(text.length)
  for (let n = 0; n < text.length; n++) module[n] = text.charCodeAt(n) & 0xff
  return module
}

/**
 * One simulator run with its debugger: the module, its virtual serial port and the Modbus RTU client the debug
 * protocol runs over. Debug data crosses as hex strings, as `SimulatorPort` carries it.
 */
export class SimulatorDebugSession {
  private simulator: SimulatorRunner | null = null
  private client: ModbusRtuClient | null = null

  /** Called when the run ends on its own, with the reason. */
  onStopped: ((reason: string) => void) | null = null
  onLog: ((line: string, stream: SimulatorLogStream) => void) | null = null

  constructor(private readonly createSimulator: () => SimulatorRunner = () => new WasmSimulatorModule()) {}

  /** Starts `module`, ending any earlier run first. Rejects, with nothing left running, when it cannot start. */
  async start(module: Uint8Array): Promise<void> {
    this.stop()
    const simulator = this.createSimulator()
    simulator.onLog = (line, stream) => this.onLog?.(line, stream)
    simulator.onStopped = (reason) => {
      this.release()
      this.onStopped?.(reason)
    }
    this.simulator = simulator
    try {
      await simulator.loadAndRun(module)
    } catch (error) {
      this.stop()
      throw error
    }
  }

  stop(): void {
    this.disconnectDebugger()
    this.simulator?.stop()
    this.simulator = null
  }

  isRunning(): boolean {
    return this.simulator?.isRunning() ?? false
  }

  async connectDebugger(): Promise<void> {
    if (!this.simulator?.isRunning()) throw new Error('Simulator is not running')
    this.disconnectDebugger()
    const client = new ModbusRtuClient({
      slaveId: MODBUS_SLAVE_ID,
      timeout: MODBUS_TIMEOUT_MS,
      readyDelayMs: 0,
      serialPort: new VirtualSerialPort(this.simulator),
    })
    await client.connect()
    this.client = client
  }

  disconnectDebugger(): void {
    this.client?.disconnect()
    this.client = null
  }

  async getMd5Hash(): Promise<string> {
    if (!this.client) throw new Error('Debugger not connected')
    return (await this.client.getMd5Hash()).md5
  }

  async getVariablesList(indexes: number[]): Promise<SimulatorDebugResult> {
    if (!this.client) return { success: false, error: 'Debugger not connected' }
    const result = await this.client.getVariablesList(indexes)
    return {
      success: result.success,
      tick: result.tick,
      lastIndex: result.lastIndex,
      data: result.success && result.data ? toHex(result.data) : undefined,
      error: result.error,
    }
  }

  async setVariable(index: number, force: boolean, valueHex?: string): Promise<{ success: boolean; error?: string }> {
    if (!this.client) return { success: false, error: 'Debugger not connected' }
    return this.client.setVariable(index, force, force && valueHex ? fromHex(valueHex) : undefined)
  }

  private release(): void {
    this.disconnectDebugger()
    this.simulator = null
  }
}
