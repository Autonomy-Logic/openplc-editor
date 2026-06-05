import { SimulatorModule } from './simulator-module'

/**
 * A virtual serial port that mimics the `serialport` npm package's event-based API.
 * Routes bytes through SimulatorModule's UART bridge, allowing the existing
 * ModbusRtuClient to communicate with the avr8js emulator unchanged.
 *
 * Uses manual listener arrays instead of Node.js EventEmitter for browser compatibility.
 */
export class VirtualSerialPort {
  public isOpen = false
  private simulator: SimulatorModule

  private dataListeners: ((data: Uint8Array) => void)[] = []
  private openListeners: (() => void)[] = []
  private errorListeners: ((err: Error) => void)[] = []

  constructor(simulator: SimulatorModule) {
    this.simulator = simulator
  }

  open(): void {
    this.isOpen = true
    // Wire UART RX: bytes from emulated device -> ModbusRtuClient via 'data' events
    this.simulator.onUartByte = (byte: number) => {
      const buf = new Uint8Array([byte])
      for (const cb of this.dataListeners) {
        cb(buf)
      }
    }
    // Emit 'open' asynchronously (matches real SerialPort behavior)
    queueMicrotask(() => {
      for (const cb of this.openListeners) {
        cb()
      }
    })
  }

  write(data: Uint8Array, callback?: (err?: Error | null) => void): void {
    // Send each byte to the emulated UART TX (host -> device)
    for (const byte of data) {
      this.simulator.feedByte(byte)
    }
    callback?.(null)
  }

  flush(callback?: (err?: Error | null) => void): void {
    // No hardware buffer to flush in virtual port
    callback?.(null)
  }

  close(): void {
    this.isOpen = false
    this.simulator.onUartByte = null
    this.removeAllListeners()
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): void {
    if (event === 'data') this.dataListeners.push(listener)
    else if (event === 'open') this.openListeners.push(listener)
    else if (event === 'error') this.errorListeners.push(listener)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  once(event: string, listener: (...args: any[]) => void): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapper = (...args: any[]) => {
      this.removeListener(event, wrapper)
      listener(...args)
    }
    this.on(event, wrapper)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  removeListener(event: string, listener: (...args: any[]) => void): void {
    if (event === 'data') this.dataListeners = this.dataListeners.filter((cb) => cb !== listener)
    else if (event === 'open') this.openListeners = this.openListeners.filter((cb) => cb !== listener)
    else if (event === 'error') this.errorListeners = this.errorListeners.filter((cb) => cb !== listener)
  }

  removeAllListeners(event?: string): void {
    if (!event || event === 'data') this.dataListeners = []
    if (!event || event === 'open') this.openListeners = []
    if (!event || event === 'error') this.errorListeners = []
  }
}
