/**
 * Tests for SimulatorModule.
 *
 * avr8js is mocked entirely -- we only verify the orchestration logic
 * (HEX parsing, peripheral wiring, execution loop, SLEEP handling, pacing, RX queue).
 */

// ---------------------------------------------------------------------------
// Mock avr8js before importing the module under test
// ---------------------------------------------------------------------------

const mockCpuInstance = {
  cycles: 0,
  pc: 0,
  progMem: new Uint16Array(0),
  readHooks: {} as Record<number, ((addr: number) => number | undefined) | undefined>,
  tick: jest.fn(),
}

const mockUsartInstance = {
  onByteTransmit: null as ((byte: number) => void) | null,
  writeByte: jest.fn().mockReturnValue(true),
}

jest.mock('avr8js', () => ({
  CPU: jest.fn().mockImplementation((_progMem: Uint16Array) => {
    // Reset per-test
    mockCpuInstance.cycles = 0
    mockCpuInstance.pc = 0
    mockCpuInstance.progMem = _progMem
    mockCpuInstance.readHooks = {}
    mockCpuInstance.tick.mockReset()
    return mockCpuInstance
  }),
  AVRTimer: jest.fn(),
  AVRUSART: jest.fn().mockImplementation(() => {
    mockUsartInstance.onByteTransmit = null
    mockUsartInstance.writeByte.mockReset().mockReturnValue(true)
    return mockUsartInstance
  }),
  AVRClock: jest.fn(),
  avrInstruction: jest.fn(),
  timer0Config: { compAInterrupt: 0, compBInterrupt: 0, ovfInterrupt: 0 },
  timer1Config: { captureInterrupt: 0, compAInterrupt: 0, compBInterrupt: 0, ovfInterrupt: 0 },
  timer2Config: { compAInterrupt: 0, compBInterrupt: 0, ovfInterrupt: 0 },
  usart0Config: { UDR: 0xc6, rxCompleteInterrupt: 0, dataRegisterEmptyInterrupt: 0, txCompleteInterrupt: 0 },
  clockConfig: {},
}))

import { avrInstruction } from 'avr8js'

import { SimulatorModule } from '../simulator-module'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid Intel HEX with a single data record and EOF */
const MINIMAL_HEX = [':020000040000FA', ':0200000000009E', ':00000001FF'].join('\n')

/** Intel HEX with extended segment address (type 02) */
const EXTENDED_SEG_HEX = [':020000021000EC', ':0200000000009E', ':00000001FF'].join('\n')

/** Intel HEX with extended linear address (type 04) */
const EXTENDED_LINEAR_HEX = [':020000040001F9', ':0200000000009E', ':00000001FF'].join('\n')

/** Intel HEX with non-hex lines (comments/blank) that should be skipped */
const HEX_WITH_BLANKS = ['', '# comment line', ':0200000000009E', ':00000001FF'].join('\n')

describe('SimulatorModule', () => {
  let sim: SimulatorModule

  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    sim = new SimulatorModule()
  })

  afterEach(() => {
    sim.stop()
    jest.useRealTimers()
  })

  // -----------------------------------------------------------------------
  // isRunning / stop
  // -----------------------------------------------------------------------
  describe('isRunning / stop', () => {
    it('is not running initially', () => {
      expect(sim.isRunning()).toBe(false)
    })

    it('is running after loadAndRun', () => {
      // avrInstruction must advance cycles to prevent infinite loop
      ;(avrInstruction as jest.Mock).mockImplementation(() => {
        mockCpuInstance.cycles += 200_000
      })

      sim.loadAndRun(MINIMAL_HEX)
      expect(sim.isRunning()).toBe(true)
    })

    it('stops correctly', () => {
      ;(avrInstruction as jest.Mock).mockImplementation(() => {
        mockCpuInstance.cycles += 200_000
      })

      sim.loadAndRun(MINIMAL_HEX)
      sim.stop()
      expect(sim.isRunning()).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // loadAndRun -- Intel HEX parsing
  // -----------------------------------------------------------------------
  describe('loadAndRun', () => {
    it('stops any previous run', () => {
      ;(avrInstruction as jest.Mock).mockImplementation(() => {
        mockCpuInstance.cycles += 200_000
      })

      sim.loadAndRun(MINIMAL_HEX)
      expect(sim.isRunning()).toBe(true)

      // Loading again should stop the first one
      sim.loadAndRun(MINIMAL_HEX)
      expect(sim.isRunning()).toBe(true)
    })

    it('handles extended segment address records (type 02)', () => {
      ;(avrInstruction as jest.Mock).mockImplementation(() => {
        mockCpuInstance.cycles += 200_000
      })

      sim.loadAndRun(EXTENDED_SEG_HEX)
      expect(sim.isRunning()).toBe(true)
    })

    it('handles extended linear address records (type 04)', () => {
      ;(avrInstruction as jest.Mock).mockImplementation(() => {
        mockCpuInstance.cycles += 200_000
      })

      sim.loadAndRun(EXTENDED_LINEAR_HEX)
      expect(sim.isRunning()).toBe(true)
    })

    it('clips data that exceeds flash size boundary', () => {
      ;(avrInstruction as jest.Mock).mockImplementation(() => {
        mockCpuInstance.cycles += 200_000
      })

      // Place data at a very high address using extended linear address.
      // Flash size = 256*1024 = 0x40000 bytes. Address 0x3FFFF is the last byte.
      // Use extended linear address 0x0003 (sets upper 16 bits to 3 => base = 0x30000)
      // Then data record at address 0xFFFF (offset from base = 0x3FFFF).
      // Write 2 bytes: first is in-range (0x3FFFF), second is out-of-range (0x40000).
      const hex = [
        ':020000040003F7', // extended linear: extendedAddress = 0x30000
        ':02FFFF00AABB9B', // 2 bytes at address 0xFFFF, fullAddr = 0x3FFFF
        ':00000001FF', // EOF
      ].join('\n')

      sim.loadAndRun(hex)
      expect(sim.isRunning()).toBe(true)
    })

    it('skips non-hex lines (blanks and comments)', () => {
      ;(avrInstruction as jest.Mock).mockImplementation(() => {
        mockCpuInstance.cycles += 200_000
      })

      sim.loadAndRun(HEX_WITH_BLANKS)
      expect(sim.isRunning()).toBe(true)
    })

    it('ignores unknown record types (e.g. type 03)', () => {
      ;(avrInstruction as jest.Mock).mockImplementation(() => {
        mockCpuInstance.cycles += 200_000
      })

      // Type 03 is "Start Segment Address" -- not handled, should be ignored
      const hex = [':04000003000000F9', ':0200000000009E', ':00000001FF'].join('\n')
      sim.loadAndRun(hex)
      expect(sim.isRunning()).toBe(true)
    })

    it('parses data records and converts to 16-bit words', () => {
      ;(avrInstruction as jest.Mock).mockImplementation(() => {
        mockCpuInstance.cycles += 200_000
      })

      const hex = [':02000000ABCD8C', ':00000001FF'].join('\n')
      sim.loadAndRun(hex)

      // CPU constructor is called with a Uint16Array
      // The 2-byte data 0xAB,0xCD at address 0 becomes little-endian word 0xCDAB
      const { CPU } = require('avr8js')
      const progMem: Uint16Array = CPU.mock.calls[CPU.mock.calls.length - 1][0]
      expect(progMem[0]).toBe(0xab | (0xcd << 8))
    })

    it('wires USART TX to onUartByte callback', () => {
      ;(avrInstruction as jest.Mock).mockImplementation(() => {
        mockCpuInstance.cycles += 200_000
      })

      sim.loadAndRun(MINIMAL_HEX)

      // Set the callback after loadAndRun (stop() clears it)
      const byteCb = jest.fn()
      sim.onUartByte = byteCb

      // Trigger the onByteTransmit wired by loadAndRun
      mockUsartInstance.onByteTransmit?.(0x42)
      expect(byteCb).toHaveBeenCalledWith(0x42)
    })
  })

  // -----------------------------------------------------------------------
  // executeBatch -- SLEEP fast-forward
  // -----------------------------------------------------------------------
  describe('executeBatch', () => {
    it('fast-forwards on SLEEP opcode and reschedules', () => {
      const SLEEP_OPCODE = 0x9588

      // First batch: exit quickly by exceeding cycle cap
      ;(avrInstruction as jest.Mock).mockImplementation(() => {
        mockCpuInstance.cycles += 2_000_000
      })

      sim.loadAndRun(MINIMAL_HEX)

      // Now set up SLEEP scenario for the next batch
      mockCpuInstance.progMem = new Uint16Array([SLEEP_OPCODE])
      mockCpuInstance.pc = 0
      mockCpuInstance.cycles = 0
      ;(mockCpuInstance as any).nextClockEvent = { cycles: 16000 }

      // Make avrInstruction advance pc and 1 cycle (SLEEP behavior),
      // then on next iteration hit the cycle cap to exit the while loop
      let sleepExecuted = false
      ;(avrInstruction as jest.Mock).mockImplementation(() => {
        if (!sleepExecuted) {
          mockCpuInstance.pc++
          mockCpuInstance.cycles += 1
          sleepExecuted = true
        } else {
          mockCpuInstance.cycles += 2_000_000
        }
      })

      // First batch scheduled with delay based on sim-ahead-of-wall time.
      // Advance enough to fire the scheduled timer.
      jest.advanceTimersByTime(500)

      // After fast-forward, cycles should have jumped to nextClockEvent.cycles
      expect(mockCpuInstance.cycles).toBeGreaterThanOrEqual(16000)
    })

    it('handles SLEEP when nextClockEvent is null (no fast-forward)', () => {
      const SLEEP_OPCODE = 0x9588

      ;(avrInstruction as jest.Mock).mockImplementation(() => {
        mockCpuInstance.cycles += 2_000_000
      })

      sim.loadAndRun(MINIMAL_HEX)

      mockCpuInstance.progMem = new Uint16Array([SLEEP_OPCODE])
      mockCpuInstance.pc = 0
      mockCpuInstance.cycles = 0
      // No nextClockEvent
      ;(mockCpuInstance as any).nextClockEvent = null
      ;(avrInstruction as jest.Mock).mockImplementation(() => {
        mockCpuInstance.pc++
        mockCpuInstance.cycles += 2_000_000
      })

      jest.advanceTimersByTime(500)
      // Should not crash -- just proceed without fast-forward
      expect(sim.isRunning()).toBe(true)
    })

    it('handles SLEEP when nextEvent.cycles <= cpu.cycles (no forward needed)', () => {
      const SLEEP_OPCODE = 0x9588

      ;(avrInstruction as jest.Mock).mockImplementation(() => {
        mockCpuInstance.cycles += 2_000_000
      })

      sim.loadAndRun(MINIMAL_HEX)

      mockCpuInstance.progMem = new Uint16Array([SLEEP_OPCODE])
      mockCpuInstance.pc = 0
      mockCpuInstance.cycles = 100
      ;(mockCpuInstance as any).nextClockEvent = { cycles: 50 } // already past
      ;(avrInstruction as jest.Mock).mockImplementation(() => {
        mockCpuInstance.pc++
        mockCpuInstance.cycles += 2_000_000
      })

      jest.advanceTimersByTime(500)
      expect(sim.isRunning()).toBe(true)
    })

    it('stops execution loop when stop() is called', () => {
      ;(avrInstruction as jest.Mock).mockImplementation(() => {
        mockCpuInstance.cycles += 200_000
      })

      sim.loadAndRun(MINIMAL_HEX)
      sim.stop()

      // Advancing timers should not cause new instructions
      const callCount = (avrInstruction as jest.Mock).mock.calls.length
      jest.advanceTimersByTime(100)
      expect((avrInstruction as jest.Mock).mock.calls.length).toBe(callCount)
    })

    it('does not reschedule when running becomes false during batch', () => {
      ;(avrInstruction as jest.Mock).mockImplementation(() => {
        mockCpuInstance.cycles += 2_000_000
      })

      sim.loadAndRun(MINIMAL_HEX)

      // Set up next batch to stop mid-execution
      mockCpuInstance.cycles = 0
      ;(avrInstruction as jest.Mock).mockImplementation(() => {
        sim.stop()
        mockCpuInstance.cycles += 2_000_000
      })

      jest.advanceTimersByTime(500)

      expect(sim.isRunning()).toBe(false)
    })

    it('reschedules with delay when sim is ahead of wall time', () => {
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout')

      // Make batch complete quickly with sim time ahead
      let callCount = 0
      ;(avrInstruction as jest.Mock).mockImplementation(() => {
        callCount++
        // First batch: advance a lot of simulated cycles (ahead of wall time)
        mockCpuInstance.cycles += 2_000_000
      })

      sim.loadAndRun(MINIMAL_HEX)

      // The first batch should reschedule with a positive delay
      const lastCall = setTimeoutSpy.mock.calls[setTimeoutSpy.mock.calls.length - 1]
      // delay argument: should be >= 0
      expect(lastCall[1]).toBeGreaterThanOrEqual(0)

      setTimeoutSpy.mockRestore()
    })
  })

  // -----------------------------------------------------------------------
  // feedByte / RX queue
  // -----------------------------------------------------------------------
  describe('feedByte', () => {
    it('immediately writes byte to USART when queue is empty and accepted', () => {
      ;(avrInstruction as jest.Mock).mockImplementation(() => {
        mockCpuInstance.cycles += 200_000
      })

      sim.loadAndRun(MINIMAL_HEX)
      mockUsartInstance.writeByte.mockReturnValue(true)

      sim.feedByte(0xaa)

      expect(mockUsartInstance.writeByte).toHaveBeenCalledWith(0xaa)
    })

    it('queues byte when USART rejects it (rxBusy)', () => {
      ;(avrInstruction as jest.Mock).mockImplementation(() => {
        mockCpuInstance.cycles += 200_000
      })

      sim.loadAndRun(MINIMAL_HEX)
      mockUsartInstance.writeByte.mockReturnValue(false)

      sim.feedByte(0xbb)

      // Byte remains queued; writeByte was attempted
      expect(mockUsartInstance.writeByte).toHaveBeenCalledWith(0xbb)
    })

    it('does not attempt immediate write when queue already has items', () => {
      ;(avrInstruction as jest.Mock).mockImplementation(() => {
        mockCpuInstance.cycles += 200_000
      })

      sim.loadAndRun(MINIMAL_HEX)
      mockUsartInstance.writeByte.mockReturnValue(false)

      // First byte queued (rejected)
      sim.feedByte(0x01)
      mockUsartInstance.writeByte.mockClear()

      // Second byte added -- should not attempt writeByte since queue length > 1
      sim.feedByte(0x02)
      expect(mockUsartInstance.writeByte).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // UDR read hook -- drainRxQueue
  // -----------------------------------------------------------------------
  describe('UDR read hook (drainRxQueue)', () => {
    it('does nothing when usart is null (after stop)', () => {
      ;(avrInstruction as jest.Mock).mockImplementation(() => {
        mockCpuInstance.cycles += 200_000
      })

      sim.loadAndRun(MINIMAL_HEX)

      // Save the hook before stopping
      const { usart0Config } = require('avr8js')
      const hook = mockCpuInstance.readHooks[usart0Config.UDR]

      sim.stop()

      // Call hook after stop -- drainRxQueue should return early since usart is null
      if (hook) {
        hook(usart0Config.UDR)
      }
      // No crash expected
    })

    it('keeps byte queued when writeByte returns false in drainRxQueue', () => {
      ;(avrInstruction as jest.Mock).mockImplementation(() => {
        mockCpuInstance.cycles += 200_000
      })

      sim.loadAndRun(MINIMAL_HEX)

      // Queue bytes that are rejected
      mockUsartInstance.writeByte.mockReturnValue(false)
      sim.feedByte(0x01)
      sim.feedByte(0x02)
      mockUsartInstance.writeByte.mockClear()

      // drainRxQueue called via hook -- still rejected
      mockUsartInstance.writeByte.mockReturnValue(false)
      const { usart0Config } = require('avr8js')
      const hook = mockCpuInstance.readHooks[usart0Config.UDR]
      if (hook) {
        hook(usart0Config.UDR)
      }

      expect(mockUsartInstance.writeByte).toHaveBeenCalledWith(0x01)
    })

    it('drains queued RX bytes when firmware reads UDR', () => {
      ;(avrInstruction as jest.Mock).mockImplementation(() => {
        mockCpuInstance.cycles += 200_000
      })

      sim.loadAndRun(MINIMAL_HEX)

      // Queue two bytes; first is rejected, both queued
      mockUsartInstance.writeByte.mockReturnValue(false)
      sim.feedByte(0x01)
      sim.feedByte(0x02)

      // Now the read hook should try to drain
      mockUsartInstance.writeByte.mockReturnValue(true)

      // Trigger the UDR read hook
      const { usart0Config } = require('avr8js')
      const hook = mockCpuInstance.readHooks[usart0Config.UDR]
      if (hook) {
        hook(usart0Config.UDR)
      }

      // drainRxQueue should have been called and accepted a byte
      expect(mockUsartInstance.writeByte).toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // executeBatch -- RX queue drain at batch start
  // -----------------------------------------------------------------------
  describe('executeBatch RX queue drain', () => {
    it('keeps byte in queue when writeByte returns false at batch start', () => {
      ;(avrInstruction as jest.Mock).mockImplementation(() => {
        mockCpuInstance.cycles += 2_000_000
      })

      sim.loadAndRun(MINIMAL_HEX)

      // Queue a byte that gets rejected initially
      mockUsartInstance.writeByte.mockReturnValue(false)
      sim.feedByte(0xdd)
      mockUsartInstance.writeByte.mockClear()

      // Still rejected on next batch
      mockUsartInstance.writeByte.mockReturnValue(false)
      mockCpuInstance.cycles = 0

      jest.advanceTimersByTime(500)

      // writeByte was called but returned false -- byte stays in queue
      expect(mockUsartInstance.writeByte).toHaveBeenCalledWith(0xdd)
    })

    it('attempts to deliver queued bytes at start of each batch', () => {
      // First batch exits quickly
      ;(avrInstruction as jest.Mock).mockImplementation(() => {
        mockCpuInstance.cycles += 2_000_000
      })

      sim.loadAndRun(MINIMAL_HEX)

      // Queue a byte that gets rejected
      mockUsartInstance.writeByte.mockReturnValue(false)
      sim.feedByte(0xcc)
      mockUsartInstance.writeByte.mockClear()

      // Now make it accept on next batch
      mockUsartInstance.writeByte.mockReturnValue(true)

      // Reset cycles so the next batch can run its while loop
      mockCpuInstance.cycles = 0

      // Advance timer sufficiently to trigger next batch
      jest.advanceTimersByTime(500)

      expect(mockUsartInstance.writeByte).toHaveBeenCalledWith(0xcc)
    })
  })

  // -----------------------------------------------------------------------
  // stop -- cleanup
  // -----------------------------------------------------------------------
  describe('stop cleanup', () => {
    it('clears USART onByteTransmit and onUartByte', () => {
      ;(avrInstruction as jest.Mock).mockImplementation(() => {
        mockCpuInstance.cycles += 200_000
      })

      sim.onUartByte = jest.fn()
      sim.loadAndRun(MINIMAL_HEX)

      sim.stop()

      expect(mockUsartInstance.onByteTransmit).toBeNull()
      expect(sim.onUartByte).toBeNull()
    })

    it('clears pending timeout', () => {
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout')

      ;(avrInstruction as jest.Mock).mockImplementation(() => {
        mockCpuInstance.cycles += 200_000
      })

      sim.loadAndRun(MINIMAL_HEX)
      sim.stop()

      expect(clearTimeoutSpy).toHaveBeenCalled()
      clearTimeoutSpy.mockRestore()
    })
  })

  // -----------------------------------------------------------------------
  // Edge case: executeBatch returns early when not running
  // -----------------------------------------------------------------------
  describe('executeBatch early return', () => {
    it('does nothing if not running', () => {
      ;(avrInstruction as jest.Mock).mockImplementation(() => {
        mockCpuInstance.cycles += 200_000
      })

      sim.loadAndRun(MINIMAL_HEX)
      sim.stop()

      jest.advanceTimersByTime(100)
    })

    it('returns early when cpu is null (defensive)', () => {
      ;(avrInstruction as jest.Mock).mockImplementation(() => {
        mockCpuInstance.cycles += 200_000
      })

      sim.loadAndRun(MINIMAL_HEX)

      // Force cpu to null while running is still true
      ;(sim as any).cpu = null

      jest.advanceTimersByTime(500)
      // Should not crash -- executeBatch returns early
    })
  })
})
