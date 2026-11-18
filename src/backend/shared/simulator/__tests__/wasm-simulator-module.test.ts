/**
 * WasmSimulatorModule against hand-made modules that use the simulator's host interface.
 * @jest-environment node
 * @vitest-environment node
 */
import { describe, expect, it } from '@jest/globals'

import { type SimulatorLogStream, type SimulatorTimers, WasmSimulatorModule } from '../wasm-simulator-module'
import { call, hostModule, PROC_EXIT, UART_WRITE } from './fixtures/host-module'
import { i32, OP, tinyModule } from './fixtures/tiny-wasm'

/** Timers driven by the test: `advance` moves the wall clock and runs every callback that came due. */
function manualTimers(options: { ignoreCancel?: boolean } = {}) {
  let now = 0
  let pending: Array<{ at: number; callback: () => void; cancelled: boolean }> = []
  const timers: SimulatorTimers = {
    now: () => now,
    schedule: (callback, delayMs) => {
      const entry = { at: now + delayMs, callback, cancelled: false }
      pending.push(entry)
      return () => {
        if (!options.ignoreCancel) entry.cancelled = true
      }
    },
  }
  const runDue = (): number => {
    const due = pending.filter((entry) => entry.at <= now && !entry.cancelled)
    pending = pending.filter((entry) => !due.includes(entry))
    for (const entry of due) entry.callback()
    return due.length
  }
  return {
    timers,
    delays: () => pending.filter((entry) => !entry.cancelled).map((entry) => entry.at - now),
    jump: (ms: number) => {
      now += ms
      runDue()
    },
    advance: (ms: number) => {
      const end = now + ms
      while (now < end) {
        now = Math.min(end, Math.min(...pending.map((entry) => entry.at), end))
        runDue()
      }
    },
    runAll: () => {
      for (const entry of pending.splice(0)) entry.callback()
    },
  }
}

function recorder(simulator: WasmSimulatorModule) {
  const uart: number[] = []
  const logs: Array<[string, SimulatorLogStream]> = []
  const stops: string[] = []
  simulator.onUartByte = (byte) => uart.push(byte)
  simulator.onLog = (line, stream) => logs.push([line, stream])
  simulator.onStopped = (reason) => stops.push(reason)
  return { uart, logs, stops }
}

describe('WasmSimulatorModule', () => {
  it("runs setup, routes the program's output by line and answers WASI calls it does not serve", async () => {
    const { timers } = manualTimers()
    const simulator = new WasmSimulatorModule(timers)
    const seen = recorder(simulator)

    await simulator.loadAndRun(hostModule())

    expect(simulator.isRunning()).toBe(true)
    expect(seen.logs).toEqual([
      ['hi', 'stdout'],
      ['err', 'stderr'],
    ])
    expect(seen.uart).toEqual([8, 70, 0, 52])
    simulator.stop()
    expect(seen.logs[2]).toEqual(['there', 'stdout'])
    expect(seen.stops).toEqual([])
  })

  it('delivers serial bytes to the program and its replies back, and ignores bytes once stopped', async () => {
    const simulator = new WasmSimulatorModule(manualTimers().timers)
    const seen = recorder(simulator)
    await simulator.loadAndRun(hostModule())
    seen.uart.length = 0

    simulator.feedByte(0x1a5)
    expect(seen.uart).toEqual([0xa5])

    simulator.stop()
    simulator.feedByte(0x01)
    expect(seen.uart).toEqual([0xa5])
    expect(simulator.isRunning()).toBe(false)
  })

  it('advances simulated time in steps of at most 10 ms, one scan per period, never ahead of the wall clock', async () => {
    const clock = manualTimers()
    const simulator = new WasmSimulatorModule(clock.timers)
    await simulator.loadAndRun(hostModule({ periodUs: 25000 }))

    expect(simulator.scanPeriodUs).toBe(25000)
    expect(clock.delays()).toEqual([10])
    clock.advance(9)
    expect(simulator.simulatedTimeUs).toBe(0)
    clock.advance(16)
    expect(simulator.simulatedTimeUs).toBe(25000)
    expect(simulator.scanCount).toBe(1)
    clock.advance(75)
    expect(simulator.simulatedTimeUs).toBe(100000)
    expect(simulator.scanCount).toBe(4)
    simulator.stop()
  })

  it('keeps pace with the wall clock when every timer fires a little late', async () => {
    const clock = manualTimers()
    const simulator = new WasmSimulatorModule(clock.timers)
    await simulator.loadAndRun(hostModule({ periodUs: 20000 }))

    let wallMs = 0
    for (let n = 0; n < 300; n++) {
      const [delay] = clock.delays()
      clock.jump(delay + 1)
      wallMs += delay + 1
    }

    expect(simulator.simulatedTimeUs).toBe(3000000)
    expect(wallMs - simulator.simulatedTimeUs / 1000).toBeGreaterThanOrEqual(0)
    expect(wallMs - simulator.simulatedTimeUs / 1000).toBeLessThanOrEqual(10)
    simulator.stop()
  })

  it('falls behind instead of catching up when the host was held up', async () => {
    const clock = manualTimers()
    const simulator = new WasmSimulatorModule(clock.timers)
    await simulator.loadAndRun(hostModule())

    clock.jump(1000)

    expect(simulator.simulatedTimeUs).toBe(10000)
    expect(clock.delays()).toEqual([10])
    simulator.stop()
  })

  it('runs nothing after stop, even when a timer fires that was already on its way', async () => {
    const clock = manualTimers({ ignoreCancel: true })
    const simulator = new WasmSimulatorModule(clock.timers)
    await simulator.loadAndRun(hostModule())

    simulator.stop()
    clock.runAll()

    expect(simulator.simulatedTimeUs).toBe(0)
  })

  it('stops scanning when something stops it from inside a scan', async () => {
    const clock = manualTimers()
    const simulator = new WasmSimulatorModule(clock.timers)
    const loop = [...i32(100), ...i32(1), ...call(UART_WRITE)]
    await simulator.loadAndRun(hostModule({ loop }))
    simulator.onUartByte = () => simulator.stop()

    clock.advance(10)

    expect(simulator.isRunning()).toBe(false)
    expect(clock.delays()).toEqual([])
  })

  it('ends the run and reports why when the program traps', async () => {
    const clock = manualTimers()
    const simulator = new WasmSimulatorModule(clock.timers)
    const seen = recorder(simulator)
    await simulator.loadAndRun(hostModule({ loop: [OP.unreachable] }))

    clock.advance(10)

    expect(simulator.isRunning()).toBe(false)
    expect(seen.stops).toHaveLength(1)
    expect(seen.stops[0]).toMatch(/^The simulator stopped: .*unreachable/)
  })

  it('ends the run with the exit code when the program exits', async () => {
    const clock = manualTimers()
    const simulator = new WasmSimulatorModule(clock.timers)
    const seen = recorder(simulator)
    await simulator.loadAndRun(hostModule({ loop: [...i32(3), ...call(PROC_EXIT)] }))

    clock.advance(10)

    expect(seen.stops).toEqual(['The simulator program exited with code 3.'])
  })

  it('refuses a program with no scan period, a module missing an export or its memory, and a second start', async () => {
    await expect(
      new WasmSimulatorModule(manualTimers().timers).loadAndRun(hostModule({ periodUs: 0 })),
    ).rejects.toThrow('The simulator program reports no scan period.')
    await expect(
      new WasmSimulatorModule(manualTimers().timers).loadAndRun(hostModule({ omit: 'sim_loop' })),
    ).rejects.toThrow("The simulator module does not export 'sim_loop'.")
    const noMemory = tinyModule({
      memory: false,
      functions: ['_initialize', 'sim_setup', 'sim_loop'].map((name) => ({
        export: name,
        params: [],
        results: [],
        body: [],
      })),
    })
    await expect(new WasmSimulatorModule(manualTimers().timers).loadAndRun(noMemory)).rejects.toThrow(
      "The simulator module does not export 'memory'.",
    )

    const simulator = new WasmSimulatorModule(manualTimers().timers)
    await simulator.loadAndRun(await WebAssembly.compile(hostModule()))
    await expect(simulator.loadAndRun(hostModule())).rejects.toThrow('This simulator run has already started.')
    simulator.stop()
  })

  it('paces itself with the platform clock and timers by default', async () => {
    const simulator = new WasmSimulatorModule()
    await simulator.loadAndRun(hostModule({ periodUs: 1000 }))
    await new Promise((resolve) => setTimeout(resolve, 50))
    simulator.stop()

    expect(simulator.simulatedTimeUs).toBeGreaterThan(0)
    expect(simulator.simulatedTimeUs / 1000).toBeLessThanOrEqual(60)
  })
})
