/**
 * @jest-environment node
 * @vitest-environment node
 */
import { describe, expect, it } from '@jest/globals'

import {
  isWasmerSdk,
  PYTHON_BOOT_READY,
  type PythonExit,
  type WasmerClient,
  type WasmerLines,
  type WasmerProcess,
  type WasmerSandbox,
  type WasmerSdk,
  WasmerPythonRuntime,
} from '../wasmer-python-runtime'

describe('isWasmerSdk', () => {
  it('accepts a module whose Wasmer is a class with a static create, as the SDK exports it', () => {
    class Wasmer {
      static create(): Promise<unknown> {
        return Promise.resolve({})
      }
    }
    expect(isWasmerSdk({ Wasmer })).toBe(true)
  })

  it('refuses anything else', () => {
    expect(isWasmerSdk({ Wasmer: {} })).toBe(false)
    expect(isWasmerSdk({ Wasmer: class {} })).toBe(false)
    expect(isWasmerSdk(null)).toBe(false)
  })
})

interface FakeProcessControl {
  stdout(line: string): void
  stderr(line: string): void
  exit(code: number): void
  trap(message: string): void
  written: string[]
  killed: boolean
}

/** A Wasmer SDK whose one sandbox process the test drives line by line. */
function fakeSdk(): { sdk: WasmerSdk; processes: FakeProcessControl[]; closed: number } {
  const state = { processes: [] as FakeProcessControl[], closed: 0 }
  const lines = (): { push(line: string): void; end(): void; stream: WasmerLines } => {
    const queue: string[] = []
    let wake: (() => void) | null = null
    let done = false
    return {
      push: (line) => {
        queue.push(line)
        wake?.()
      },
      end: () => {
        done = true
        wake?.()
      },
      stream: {
        async *lines() {
          for (;;) {
            if (queue.length > 0) {
              yield queue.shift() ?? ''
              continue
            }
            if (done) return
            await new Promise<void>((resolve) => (wake = resolve))
            wake = null
          }
        },
      },
    }
  }
  const sandbox: WasmerSandbox = {
    command: () => ({
      spawn: () => {
        const out = lines()
        const err = lines()
        let settle: { resolve: (o: { exitCode: number }) => void; reject: (e: Error) => void } | null = null
        const waited = new Promise<{ exitCode: number }>((resolve, reject) => (settle = { resolve, reject }))
        const control: FakeProcessControl = {
          written: [],
          killed: false,
          stdout: (line) => out.push(line),
          stderr: (line) => err.push(line),
          exit: (code) => {
            out.end()
            err.end()
            settle?.resolve({ exitCode: code })
          },
          trap: (message) => {
            out.end()
            err.end()
            settle?.reject(new Error(message))
          },
        }
        state.processes.push(control)
        const process: WasmerProcess = {
          stdin: {
            write: (data) => {
              control.written.push(String(data))
              return Promise.resolve()
            },
            close: () => Promise.resolve(),
          },
          stdout: out.stream,
          stderr: err.stream,
          wait: () => waited,
          kill: () => {
            control.killed = true
            control.exit(137)
            return Promise.resolve()
          },
        }
        return Promise.resolve(process)
      },
    }),
    close: () => {
      state.closed++
      return Promise.resolve()
    },
  }
  const client: WasmerClient = {
    packages: { load: () => Promise.resolve('package') },
    sandboxes: { create: () => Promise.resolve(sandbox) },
  }
  return {
    sdk: { Wasmer: { create: () => Promise.resolve(client) } },
    get processes() {
      return state.processes
    },
    get closed() {
      return state.closed
    },
  }
}

const assets = { pythonPackage: new Uint8Array([1]), numpyWheel: new Uint8Array([2]) }
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe('WasmerPythonRuntime', () => {
  it('hands out an interpreter only once it has booted, then relays its output and its exit', async () => {
    const fake = fakeSdk()
    const runtime = await WasmerPythonRuntime.load(fake.sdk, assets)
    let ready = false
    const spawning = runtime.spawn().then((process) => {
      ready = true
      return process
    })
    await tick()
    expect(ready).toBe(false)
    fake.processes[0].stdout(PYTHON_BOOT_READY)
    const process = await spawning

    const out: string[] = []
    const err: string[] = []
    const exits: PythonExit[] = []
    process.onStdout = (line) => out.push(line)
    process.onStderr = (line) => err.push(line)
    process.onExit = (exit) => exits.push(exit)
    process.write('hello\n')
    fake.processes[0].stdout('from python')
    fake.processes[0].stderr('warning')
    await tick()
    fake.processes[0].exit(0)
    await tick()

    expect(fake.processes[0].written).toEqual(['hello\n'])
    expect(out).toEqual(['from python'])
    expect(err).toEqual(['warning'])
    expect(exits).toEqual([{ kind: 'exited', code: 0 }])
    expect(fake.closed).toBe(1)
  })

  it('rejects the spawn with what Python printed when it dies while booting', async () => {
    const fake = fakeSdk()
    const runtime = await WasmerPythonRuntime.load(fake.sdk, assets)
    const spawning = runtime.spawn()
    await tick()
    fake.processes[0].stderr('MemoryError')
    await tick()
    fake.processes[0].exit(1)
    await expect(spawning).rejects.toThrow('The Python interpreter could not start: exit code 1\nMemoryError')
  })

  it('reports a kill as asked for, and a trap with its reason', async () => {
    const fake = fakeSdk()
    const runtime = await WasmerPythonRuntime.load(fake.sdk, assets)
    const exits: PythonExit[] = []
    for (let n = 0; n < 2; n++) {
      const spawning = runtime.spawn()
      await tick()
      fake.processes[n].stdout(PYTHON_BOOT_READY)
      const process = await spawning
      process.onExit = (exit) => exits.push(exit)
      if (n === 0) {
        process.kill()
        process.kill()
      } else fake.processes[n].trap('RuntimeError: unreachable')
      await tick()
      process.write('ignored\n')
    }
    expect(exits).toEqual([{ kind: 'killed' }, { kind: 'failed', reason: 'RuntimeError: unreachable' }])
    expect(fake.processes[1].written).toEqual([])
  })
})
