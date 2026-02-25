import {
  AVRClock,
  avrInstruction,
  AVRTimer,
  AVRUSART,
  clockConfig,
  CPU,
  timer0Config,
  timer1Config,
  timer2Config,
  usart0Config,
} from 'avr8js'
import { readFile } from 'fs/promises'

// ATmega2560 specs
const CPU_FREQ_HZ = 16_000_000
const FLASH_SIZE_BYTES = 256 * 1024
// Expanded SRAM: fill the entire 16-bit address space (64 KB).
// The CPU constructor adds 0x100 internally for registers + standard I/O (0x00–0xFF).
// We supply 0xFF00 (65280) to cover extended I/O (0x100–0x1FF) plus usable SRAM
// (0x200–0xFFFF = 65024 bytes ≈ 63.5 KB). This is the maximum addressable with
// AVR's 16-bit data pointers. The linker flags in hals.json tell avr-gcc about
// the expanded space so it actually uses it.
const SRAM_BYTES = 0xff00

// SLEEP opcode – the firmware inserts `__asm volatile("sleep")` at the end
// of each loop() iteration. We detect it before execution and fast-forward
// the clock to the next timer event, avoiding millions of idle cycles.
const SLEEP_OPCODE = 0x9588

// Nanoseconds per CPU cycle at 16 MHz
const CYCLE_NS = 1e9 / CPU_FREQ_HZ // 62.5 ns

// Maximum real (non-skipped) instructions per batch. SLEEP fast-forwards
// don't count against this budget, so idle periods are essentially free.
const MAX_REAL_INSTRUCTIONS = 100_000

// Maximum simulated time per batch (in CPU cycles). Prevents runaway
// batches when the firmware is mostly idle (SLEEP fast-forwards could
// cover seconds of sim time without hitting the instruction limit).
const MAX_SIM_CYCLES_PER_BATCH = CPU_FREQ_HZ / 10 // 100ms

// ---------------------------------------------------------------------------
// ATmega2560 peripheral configs – register addresses are identical to the
// ATmega328p defaults exported by avr8js, only the interrupt vector addresses
// differ because ATmega2560 has more interrupt sources.
// Vector addresses are word addresses matching the datasheet.
// ---------------------------------------------------------------------------

// ATmega2560 vector addresses (word addresses).
// IMPORTANT: ATmega2560 has TIMER1_COMPC at vector 19 (word 0x26) which
// ATmega328p lacks. This shifts Timer1 OVF and all subsequent vectors by 2
// compared to a naive mapping from the ATmega328p table.
// Vectors verified against avr-objdump of compiled firmware.
const mega2560Timer0Config = {
  ...timer0Config,
  compAInterrupt: 0x2a, // vector 21
  compBInterrupt: 0x2c, // vector 22
  ovfInterrupt: 0x2e, // vector 23
}

const mega2560Timer1Config = {
  ...timer1Config,
  captureInterrupt: 0x20, // vector 16
  compAInterrupt: 0x22, // vector 17
  compBInterrupt: 0x24, // vector 18
  // Note: TIMER1_COMPC at vector 19 (0x26) not modeled by avr8js
  ovfInterrupt: 0x28, // vector 20
}

const mega2560Timer2Config = {
  ...timer2Config,
  compAInterrupt: 0x1a, // vector 13
  compBInterrupt: 0x1c, // vector 14
  ovfInterrupt: 0x1e, // vector 15
}

const mega2560Usart0Config = {
  ...usart0Config,
  rxCompleteInterrupt: 0x32, // vector 25
  dataRegisterEmptyInterrupt: 0x34, // vector 26
  txCompleteInterrupt: 0x36, // vector 27
}

// ---------------------------------------------------------------------------
// Intel HEX parser
// ---------------------------------------------------------------------------

/**
 * Parses an Intel HEX string into a Uint16Array suitable for the AVR CPU.
 * Supports record types 00 (data), 01 (EOF), 02 (extended segment address),
 * and 04 (extended linear address) for flash sizes >64 KB.
 */
function parseIntelHex(hex: string, flashSizeBytes: number): Uint16Array {
  const flash = new Uint8Array(flashSizeBytes)
  let extendedAddress = 0

  for (const rawLine of hex.split('\n')) {
    const line = rawLine.trim()
    if (!line.startsWith(':')) continue

    const byteCount = parseInt(line.substring(1, 3), 16)
    const address = parseInt(line.substring(3, 7), 16)
    const recordType = parseInt(line.substring(7, 9), 16)

    if (recordType === 0x00) {
      // Data record
      const fullAddress = extendedAddress + address
      for (let i = 0; i < byteCount; i++) {
        const byte = parseInt(line.substring(9 + i * 2, 11 + i * 2), 16)
        if (fullAddress + i < flashSizeBytes) {
          flash[fullAddress + i] = byte
        }
      }
    } else if (recordType === 0x01) {
      // End of file
      break
    } else if (recordType === 0x02) {
      // Extended segment address (address << 4)
      extendedAddress = parseInt(line.substring(9, 13), 16) << 4
    } else if (recordType === 0x04) {
      // Extended linear address (upper 16 bits)
      extendedAddress = parseInt(line.substring(9, 13), 16) << 16
    }
  }

  // Convert byte array to 16-bit little-endian words for the AVR CPU
  const words = new Uint16Array(flashSizeBytes / 2)
  for (let i = 0; i < flashSizeBytes; i += 2) {
    words[i / 2] = flash[i] | (flash[i + 1] << 8)
  }
  return words
}

// ---------------------------------------------------------------------------
// Simulator module
// ---------------------------------------------------------------------------

/**
 * Manages the avr8js ATmega2560 emulator lifecycle in the main process.
 *
 * The firmware is compiled with SIMULATOR_MODE which inserts a SLEEP
 * instruction at the end of each loop() iteration. When the CPU hits SLEEP,
 * the execution loop fast-forwards the clock to the next timer event
 * (typically Timer0 overflow at ~1 ms), avoiding millions of wasted
 * busy-wait instruction cycles and allowing the simulation to run at
 * near real-time speed.
 */
export class SimulatorModule {
  private cpu: CPU | null = null
  private running = false
  private timerHandle: ReturnType<typeof setTimeout> | null = null

  // Peripherals (kept alive so they process register read/write hooks)
  private timer0: AVRTimer | null = null
  private timer1: AVRTimer | null = null
  private timer2: AVRTimer | null = null
  private usart0: AVRUSART | null = null
  private clock: AVRClock | null = null

  // RX byte queue – avr8js USART accepts one byte at a time (returns false
  // while rxBusy). Incoming bytes are queued and drained after the firmware
  // reads UDR (via the read hook), ensuring the RXC ISR processes each byte
  // before the next one overwrites rxByte.
  private rxQueue: number[] = []

  // Wall-clock pacing
  private wallStartMs = 0
  private simStartCycles = 0

  /** Callback fired for each byte transmitted by the emulated USART0 */
  onUartByte: ((byte: number) => void) | null = null

  /**
   * Loads an Intel HEX firmware file and starts the emulated ATmega2560.
   * Stops any currently running emulation first.
   */
  async loadAndRun(hexPath: string): Promise<void> {
    this.stop()

    const hexData = await readFile(hexPath, 'utf-8')
    const progMem = parseIntelHex(hexData, FLASH_SIZE_BYTES)

    this.cpu = new CPU(progMem, SRAM_BYTES)

    // Instantiate peripherals – they register read/write hooks on the CPU
    this.timer0 = new AVRTimer(this.cpu, mega2560Timer0Config)
    this.timer1 = new AVRTimer(this.cpu, mega2560Timer1Config)
    this.timer2 = new AVRTimer(this.cpu, mega2560Timer2Config)
    this.usart0 = new AVRUSART(this.cpu, mega2560Usart0Config, CPU_FREQ_HZ)
    this.clock = new AVRClock(this.cpu, CPU_FREQ_HZ, clockConfig)

    // Wrap the UDR read hook so that after the firmware reads a received byte,
    // the next queued byte is fed into the USART. This ensures the RXC ISR
    // has consumed the current byte before the next one arrives, preventing
    // rxByte from being silently overwritten when interrupts are disabled
    // (e.g. while the CPU is inside another ISR like Timer0).
    const udrAddr = mega2560Usart0Config.UDR
    const originalUdrReadHook = this.cpu.readHooks[udrAddr]
    this.cpu.readHooks[udrAddr] = (addr: number) => {
      const result = originalUdrReadHook?.(addr)
      this.drainRxQueue()
      return result
    }

    // Wire USART0 TX to the Modbus RTU bridge callback
    this.usart0.onByteTransmit = (byte: number) => {
      this.onUartByte?.(byte)
    }

    // Begin execution
    this.running = true
    this.wallStartMs = performance.now()
    this.simStartCycles = 0
    this.executeBatch()
  }

  /**
   * Runs a batch of CPU instructions, then reschedules.
   *
   * When the CPU hits a SLEEP opcode, the loop fast-forwards the clock to
   * the next scheduled timer event instead of stepping through idle cycles.
   * SLEEP fast-forwards don't count against the instruction budget, so idle
   * periods between scan cycles are essentially free.
   *
   * After each batch, compares simulated time against wall time:
   * - If sim is ahead: schedules next batch with setTimeout(delay) to
   *   let wall time catch up, keeping timers accurate.
   * - If sim is behind or on time: schedules with setTimeout(0).
   */
  private executeBatch = (): void => {
    if (!this.running || !this.cpu) return

    this.timerHandle = null
    const { cpu } = this

    // Kick-start the RX delivery chain if bytes are queued.
    // feedByte() only attempts writeByte when the queue transitions from
    // empty to non-empty.  If that initial attempt is rejected (rxBusy was
    // true because a previous byte's clock event hadn't fired yet), no
    // further delivery attempts happen until drainRxQueue() is called from
    // the UDR read hook — which itself requires a successful delivery.
    // Retrying here at the top of each batch breaks that deadlock.
    if (this.rxQueue.length > 0 && this.usart0) {
      const byte = this.rxQueue[0]
      if (this.usart0.writeByte(byte)) {
        this.rxQueue.shift()
      }
    }

    const simCycleCap = cpu.cycles + MAX_SIM_CYCLES_PER_BATCH
    let realCount = 0

    while (this.running && realCount < MAX_REAL_INSTRUCTIONS && cpu.cycles < simCycleCap) {
      if (cpu.progMem[cpu.pc] === SLEEP_OPCODE) {
        // Execute the SLEEP instruction (advances PC, adds 1 cycle)
        avrInstruction(cpu)
        // Fast-forward to next scheduled clock event.
        // NOTE: nextClockEvent is private in avr8js — pinned to 0.20.0 in package.json.
        // If upgrading avr8js, verify this field still exists and has a `cycles` property.
        const nextEvent = (cpu as unknown as { nextClockEvent: { cycles: number } | null }).nextClockEvent
        if (nextEvent && nextEvent.cycles > cpu.cycles) {
          cpu.cycles = nextEvent.cycles
        }
        cpu.tick()
      } else {
        avrInstruction(cpu)
        cpu.tick()
        realCount++
      }
    }

    if (this.running) {
      // Pace simulation to wall time
      const simElapsedMs = ((cpu.cycles - this.simStartCycles) * CYCLE_NS) / 1e6
      const wallElapsedMs = performance.now() - this.wallStartMs
      const aheadMs = simElapsedMs - wallElapsedMs
      this.timerHandle = setTimeout(this.executeBatch, aheadMs > 1 ? Math.floor(aheadMs) : 0)
    }
  }

  /** Send a byte to the emulated USART0 RX (host → device) */
  feedByte(byte: number): void {
    this.rxQueue.push(byte)
    if (this.rxQueue.length === 1 && this.usart0) {
      const accepted = this.usart0.writeByte(byte)
      if (accepted) {
        this.rxQueue.shift()
      }
    }
  }

  /**
   * Tries to deliver the next queued byte to the USART. Called after the
   * firmware reads UDR (via the read hook). This pacing ensures the RXC ISR
   * processes each byte before the next one arrives, avoiding data loss
   * from rxByte overwrites.
   */
  private drainRxQueue(): void {
    if (!this.usart0 || this.rxQueue.length === 0) return
    const byte = this.rxQueue[0]
    const accepted = this.usart0.writeByte(byte)
    if (accepted) {
      this.rxQueue.shift()
    }
  }

  /** Stop the emulator and release resources */
  stop(): void {
    this.running = false
    if (this.timerHandle !== null) {
      clearTimeout(this.timerHandle)
      this.timerHandle = null
    }
    if (this.usart0) {
      this.usart0.onByteTransmit = null
      this.usart0 = null
    }
    this.rxQueue = []
    this.cpu = null
    this.timer0 = null
    this.timer1 = null
    this.timer2 = null
    this.clock = null
    this.onUartByte = null
  }

  /** Check if the emulator is currently running */
  isRunning(): boolean {
    return this.running
  }
}
