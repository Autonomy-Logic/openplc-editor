import { readFile } from 'fs/promises'
import { RP2040 } from 'rp2040js'

import { bootromB1 } from './bootrom'

// RP2040 flash starts at 0x10000000 (268435456 decimal)
const FLASH_START_ADDRESS = 0x10000000

// UF2 block constants
const UF2_MAGIC_START0 = 0x0a324655
const UF2_MAGIC_START1 = 0x9e5d5157
const UF2_MAGIC_END = 0x0ab16f30
const UF2_BLOCK_SIZE = 512

// Nominal nanoseconds per CPU cycle at 125 MHz
const NOMINAL_CYCLE_NANOS = 1e9 / 125_000_000 // 8 ns

// Iterations per execution batch. Kept at the stock 1M so that each batch
// yields to the event loop frequently enough for responsive Modbus I/O.
const ITERATIONS_PER_BATCH = 1_000_000

// How often (in batches) to recalibrate the speed ratio
const CALIBRATION_INTERVAL = 10

/**
 * Minimal simulation clock that satisfies the RP2040 IClock interface and
 * exposes `tick()` / `nanosToNextAlarm` for the execution loop.
 * Avoids a deep import from rp2040js internals.
 */
class SimClock {
  readonly frequency: number
  private nanosCounter = 0
  private nextAlarm: SimAlarm | null = null

  constructor(frequency = 125e6) {
    this.frequency = frequency
  }

  get nanos(): number {
    return this.nanosCounter
  }

  createAlarm(callback: () => void): SimAlarm {
    return new SimAlarm(this, callback)
  }

  linkAlarm(nanos: number, alarm: SimAlarm): void {
    alarm.nanos = this.nanos + nanos
    let item = this.nextAlarm
    let last: SimAlarm | null = null
    while (item && item.nanos < alarm.nanos) {
      last = item
      item = item.next
    }
    if (last) {
      last.next = alarm
      alarm.next = item
    } else {
      this.nextAlarm = alarm
      alarm.next = item
    }
    alarm.scheduled = true
  }

  unlinkAlarm(alarm: SimAlarm): void {
    let item = this.nextAlarm
    let last: SimAlarm | null = null
    while (item) {
      if (item === alarm) {
        if (last) {
          last.next = item.next
        } else {
          this.nextAlarm = item.next
        }
        return
      }
      last = item
      item = item.next
    }
  }

  tick(deltaNanos: number): void {
    const target = this.nanosCounter + deltaNanos
    let alarm = this.nextAlarm
    while (alarm && alarm.nanos <= target) {
      this.nextAlarm = alarm.next
      this.nanosCounter = alarm.nanos
      alarm.callback()
      alarm = this.nextAlarm
    }
    this.nanosCounter = target
  }

  get nanosToNextAlarm(): number {
    return this.nextAlarm ? this.nextAlarm.nanos - this.nanos : 0
  }
}

class SimAlarm {
  next: SimAlarm | null = null
  nanos = 0
  scheduled = false
  constructor(
    private readonly clock: SimClock,
    readonly callback: () => void,
  ) {}
  schedule(deltaNanos: number): void {
    if (this.scheduled) this.cancel()
    this.clock.linkAlarm(deltaNanos, this)
  }
  cancel(): void {
    this.clock.unlinkAlarm(this)
    this.scheduled = false
  }
}

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
 *
 * The OpenPLC firmware busy-waits in loop() checking micros(), so the CPU
 * never enters WFI. A JavaScript ARM emulator can only execute ~30-40M
 * instructions/sec, but real-time needs 125M/sec. To compensate, we
 * dynamically measure the sim-to-wall speed ratio and scale the clock tick
 * per instruction so that timers fire at real wall-clock time.
 */
export class SimulatorModule {
  private mcu: RP2040 | null = null
  private clock: SimClock | null = null
  private running = false
  private immediateHandle: ReturnType<typeof setImmediate> | null = null

  // Speed compensation: scale cycleNanos so simulated time matches wall time
  private cycleNanos = NOMINAL_CYCLE_NANOS
  private wallStartMs = 0
  private simStartNanos = 0
  private batchCount = 0

  /** Callback fired for each byte transmitted by the emulated UART0 */
  onUartByte: ((byte: number) => void) | null = null

  /**
   * Loads a UF2 firmware file and starts the emulated RP2040.
   * Stops any currently running emulation first.
   */
  async loadAndRun(uf2Path: string): Promise<void> {
    this.stop()

    const uf2Data = await readFile(uf2Path)

    this.clock = new SimClock()
    this.mcu = new RP2040(this.clock)
    this.mcu.loadBootrom(bootromB1)
    loadUF2(new Uint8Array(uf2Data), this.mcu)

    // Wire UART0 output to the Modbus RTU bridge callback
    this.mcu.uart[0].onByte = (byte: number) => {
      this.onUartByte?.(byte)
    }

    // Set program counter to flash start and begin execution
    this.mcu.core.PC = FLASH_START_ADDRESS
    this.running = true
    this.cycleNanos = NOMINAL_CYCLE_NANOS
    this.wallStartMs = performance.now()
    this.simStartNanos = 0
    this.batchCount = 0
    this.executeBatch()
  }

  /**
   * Runs a batch of CPU instructions, then reschedules with setImmediate.
   *
   * Every CALIBRATION_INTERVAL batches, we measure how much simulated time
   * has elapsed vs wall time and adjust cycleNanos so the simulation keeps
   * pace with real time. This compensates for the host CPU being slower
   * than 125 MHz worth of emulated instructions.
   */
  private executeBatch = (): void => {
    if (!this.running || !this.mcu || !this.clock) return

    this.immediateHandle = null
    const { mcu, clock } = this
    const cn = this.cycleNanos

    for (let i = 0; i < ITERATIONS_PER_BATCH && this.running; i++) {
      if (mcu.core.waiting) {
        const { nanosToNextAlarm } = clock
        clock.tick(nanosToNextAlarm)
        i += nanosToNextAlarm / cn
      } else {
        const cycles = mcu.core.executeInstruction()
        clock.tick(cycles * cn)
      }
    }

    // Periodically recalibrate so simulated time tracks wall time
    this.batchCount++
    if (this.batchCount % CALIBRATION_INTERVAL === 0) {
      const wallElapsedMs = performance.now() - this.wallStartMs
      const simElapsedMs = clock.nanos / 1e6

      if (wallElapsedMs > 100 && simElapsedMs > 0) {
        const ratio = simElapsedMs / wallElapsedMs
        // Scale cycleNanos inversely to the ratio: if sim runs at 0.25x,
        // we need 4x the nanos per cycle to catch up.
        // Clamp to reasonable bounds (1x-8x nominal) to avoid instability.
        const correction = 1 / ratio
        const clamped = Math.max(1, Math.min(8, correction))
        this.cycleNanos = NOMINAL_CYCLE_NANOS * clamped
      }
    }

    if (this.running) {
      this.immediateHandle = setImmediate(this.executeBatch)
    }
  }

  /** Send a byte to the emulated UART0 RX (host → device) */
  feedByte(byte: number): void {
    this.mcu?.uart[0].feedByte(byte)
  }

  /** Stop the emulator and release resources */
  stop(): void {
    this.running = false
    if (this.immediateHandle !== null) {
      clearImmediate(this.immediateHandle)
      this.immediateHandle = null
    }
    if (this.mcu) {
      this.mcu.uart[0].onByte = undefined
      this.mcu = null
    }
    this.clock = null
    this.onUartByte = null
  }

  /** Check if the emulator is currently running */
  isRunning(): boolean {
    return this.running
  }
}
