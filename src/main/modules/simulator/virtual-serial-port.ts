import { EventEmitter } from 'events'

import { SimulatorModule } from './simulator-module'

/**
 * A virtual serial port that mimics the `serialport` npm package's event-based API.
 * Routes bytes through SimulatorModule's UART bridge, allowing the existing
 * ModbusRtuClient to communicate with the avr8js emulator unchanged.
 */
export class VirtualSerialPort extends EventEmitter {
  public isOpen = false
  private simulator: SimulatorModule

  constructor(simulator: SimulatorModule) {
    super()
    this.simulator = simulator
  }

  open(): void {
    this.isOpen = true
    // Wire UART RX: bytes from emulated device → ModbusRtuClient via 'data' events
    this.simulator.onUartByte = (byte: number) => {
      this.emit('data', Buffer.from([byte]))
    }
    // Emit 'open' asynchronously (matches real SerialPort behavior)
    process.nextTick(() => this.emit('open'))
  }

  write(data: Uint8Array | Buffer, callback?: (err?: Error | null) => void): void {
    // Send each byte to the emulated UART TX (host → device)
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
}
