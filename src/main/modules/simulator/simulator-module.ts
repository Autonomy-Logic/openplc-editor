import { readFile } from 'fs/promises'
import { RP2040, Simulator } from 'rp2040js'

import { bootromB1 } from './bootrom'

// RP2040 flash starts at 0x10000000 (268435456 decimal)
const FLASH_START_ADDRESS = 0x10000000

// UF2 block constants
const UF2_MAGIC_START0 = 0x0a324655
const UF2_MAGIC_START1 = 0x9e5d5157
const UF2_MAGIC_END = 0x0ab16f30
const UF2_BLOCK_SIZE = 512

/**
 * Parses a UF2 firmware binary and writes its payload blocks to the RP2040 flash memory.
 * UF2 format: 512-byte blocks with magic numbers, target address, and payload data.
 * See https://github.com/microsoft/uf2 for format specification.
 */
function loadUF2(data: Uint8Array, mcu: RP2040): void {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  for (let offset = 0; offset + UF2_BLOCK_SIZE <= data.length; offset += UF2_BLOCK_SIZE) {
    const magic0 = view.getUint32(offset + 0, true)
    const magic1 = view.getUint32(offset + 4, true)
    const magicEnd = view.getUint32(offset + UF2_BLOCK_SIZE - 4, true)

    if (magic0 !== UF2_MAGIC_START0 || magic1 !== UF2_MAGIC_START1 || magicEnd !== UF2_MAGIC_END) {
      continue // skip invalid blocks
    }

    const targetAddress = view.getUint32(offset + 12, true)
    const payloadSize = view.getUint32(offset + 16, true)

    if (payloadSize > 476 || targetAddress < FLASH_START_ADDRESS) {
      continue // skip blocks outside flash range
    }

    const flashOffset = targetAddress - FLASH_START_ADDRESS
    const payload = data.subarray(offset + 32, offset + 32 + payloadSize)
    mcu.flash.set(payload, flashOffset)
  }
}

/**
 * Manages the rp2040js emulator lifecycle in the main process.
 * Uses the Simulator class which properly handles clock ticking, CPU wait states,
 * and timer-based peripherals (UART, etc.).
 */
export class SimulatorModule {
  private simulator: Simulator | null = null

  /** Callback fired for each byte transmitted by the emulated UART0 */
  onUartByte: ((byte: number) => void) | null = null

  /**
   * Loads a UF2 firmware file and starts the emulated RP2040.
   * Stops any currently running emulation first.
   */
  async loadAndRun(uf2Path: string): Promise<void> {
    this.stop()

    const uf2Data = await readFile(uf2Path)

    this.simulator = new Simulator()
    const mcu = this.simulator.rp2040
    mcu.loadBootrom(bootromB1)
    loadUF2(new Uint8Array(uf2Data), mcu)

    // Wire UART0 output to the Modbus RTU bridge callback
    mcu.uart[0].onByte = (byte: number) => {
      this.onUartByte?.(byte)
    }

    // Set program counter to flash start and begin execution
    mcu.core.PC = FLASH_START_ADDRESS
    this.simulator.execute()
  }

  /** Send a byte to the emulated UART0 RX (host → device) */
  feedByte(byte: number): void {
    this.simulator?.rp2040.uart[0].feedByte(byte)
  }

  /** Stop the emulator and release resources */
  stop(): void {
    if (this.simulator) {
      this.simulator.stop()
      this.simulator.rp2040.uart[0].onByte = undefined
      this.simulator = null
    }
    this.onUartByte = null
  }

  /** Check if the emulator is currently running */
  isRunning(): boolean {
    return this.simulator !== null && this.simulator.executing
  }
}
