/**
 * @jest-environment node
 * @vitest-environment node
 */
import { describe, expect, it } from '@jest/globals'

import type {
  PythonThreadChannel,
  PythonThreadHandle,
  PythonThreadMechanism,
} from '../../../../middleware/shared/ports/python-mechanisms'
import {
  parsePythonThreadReply,
  parsePythonThreadRequest,
  type PythonInterpreters,
  servePythonThread,
  ThreadedPythonRuntime,
} from '../python-thread'
import type { PythonExit, PythonProcess } from '../wasmer-python-runtime'

class EchoProcess implements PythonProcess {
  onStdout: ((line: string) => void) | null = null
  onStderr: ((line: string) => void) | null = null
  onExit: ((exit: PythonExit) => void) | null = null
  killed = false

  write(text: string): void {
    if (text === 'exit\n') this.onExit?.({ kind: 'exited', code: 3 })
    else if (text.startsWith('err ')) this.onStderr?.(text.slice(4).trim())
    else this.onStdout?.(text.trim())
  }

  kill(): void {
    this.killed = true
    this.onExit?.({ kind: 'killed' })
  }
}

interface FakeThread extends PythonThreadHandle {
  crash(reason: string): void
  terminated: boolean
}

/** A thread running `servePythonThread` in this process, with messages delivered asynchronously. */
function inMemoryThread(
  load: () => Promise<PythonInterpreters>,
): PythonThreadMechanism & { threads: FakeThread[]; spawns: number } {
  const mechanism = {
    threads: [] as FakeThread[],
    spawns: 0,
    spawn: (): FakeThread => {
      mechanism.spawns++
      const toMain: Array<(message: unknown) => void> = []
      const toThread: Array<(message: unknown) => void> = []
      const failures: Array<(reason: string) => void> = []
      const deliver = (listeners: Array<(message: unknown) => void>, message: unknown): void => {
        setImmediate(() => {
          for (const listener of listeners) listener(message)
        })
      }
      const channel: PythonThreadChannel = {
        post: (message) => deliver(toMain, message),
        onMessage: (listener) => toThread.push(listener),
      }
      const thread: FakeThread = {
        post: (message) => deliver(toThread, message),
        onMessage: (listener) => toMain.push(listener),
        onFailure: (listener) => failures.push(listener),
        crash: (reason) => {
          for (const listener of failures) listener(reason)
        },
        terminated: false,
        terminate: () => {
          thread.terminated = true
        },
      }
      servePythonThread(channel, load)
      mechanism.threads.push(thread)
      return thread
    },
  }
  return mechanism
}

const echoRuntime = (processes: EchoProcess[] = []): (() => Promise<PythonInterpreters>) => {
  return () =>
    Promise.resolve({
      spawn: () => {
        const process = new EchoProcess()
        processes.push(process)
        return Promise.resolve(process)
      },
    })
}

const next = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe('ThreadedPythonRuntime with servePythonThread', () => {
  it('loads the runtime once and runs interpreters across the boundary', async () => {
    const mechanism = inMemoryThread(echoRuntime())
    const runtime = new ThreadedPythonRuntime(mechanism)
    await runtime.load()
    await runtime.load()
    expect(mechanism.spawns).toBe(1)

    const process = await runtime.spawn()
    const out: string[] = []
    const err: string[] = []
    const exits: PythonExit[] = []
    process.onStdout = (line) => out.push(line)
    process.onStderr = (line) => err.push(line)
    process.onExit = (code) => exits.push(code)
    process.write('hello\n')
    process.write('err oops\n')
    process.write('exit\n')
    for (let n = 0; n < 6; n++) await next()
    process.write('ignored\n')
    await next()

    expect(out).toEqual(['hello'])
    expect(err).toEqual(['oops'])
    expect(exits).toEqual([{ kind: 'exited', code: 3 }])
  })

  it('kills an interpreter in the thread', async () => {
    const processes: EchoProcess[] = []
    const runtime = new ThreadedPythonRuntime(inMemoryThread(echoRuntime(processes)))
    const process = await runtime.spawn()
    const exits: PythonExit[] = []
    process.onExit = (code) => exits.push(code)
    process.kill()
    for (let n = 0; n < 4; n++) await next()
    expect(processes[0].killed).toBe(true)
    expect(exits).toEqual([{ kind: 'killed' }])
  })

  it('rejects the load with the reason, and tries again on the next load', async () => {
    let attempts = 0
    const mechanism = inMemoryThread(() => {
      attempts++
      return attempts === 1 ? Promise.reject(new Error('package missing')) : echoRuntime()()
    })
    const runtime = new ThreadedPythonRuntime(mechanism)
    await expect(runtime.load()).rejects.toThrow('package missing')
    expect(mechanism.threads[0].terminated).toBe(true)
    await expect(runtime.spawn()).resolves.toBeDefined()
    expect(mechanism.spawns).toBe(2)
    expect(mechanism.threads[1].terminated).toBe(false)
  })

  it('rejects a spawn the runtime refuses', async () => {
    const runtime = new ThreadedPythonRuntime(
      inMemoryThread(() => Promise.resolve({ spawn: () => Promise.reject(new Error('no memory')) })),
    )
    await expect(runtime.spawn()).rejects.toThrow('no memory')
  })

  it('ends the interpreters of a thread that dies, and starts a new thread on the next load', async () => {
    const mechanism = inMemoryThread(echoRuntime())
    const runtime = new ThreadedPythonRuntime(mechanism)
    const process = await runtime.spawn()
    const exits: PythonExit[] = []
    process.onExit = (code) => exits.push(code)
    mechanism.threads[0].crash('out of memory')
    expect(exits).toEqual([{ kind: 'failed', reason: 'The Python thread stopped: out of memory' }])
    expect(mechanism.threads[0].terminated).toBe(true)

    await runtime.load()
    expect(mechanism.spawns).toBe(2)
  })

  it('rejects the load when the thread dies before it is ready, or cannot start', async () => {
    const mechanism = inMemoryThread(() => new Promise<PythonInterpreters>(() => undefined))
    const runtime = new ThreadedPythonRuntime(mechanism)
    const loading = runtime.load()
    await next()
    mechanism.threads[0].crash('killed')
    await expect(loading).rejects.toThrow('The Python thread stopped: killed')
    expect(mechanism.threads[0].terminated).toBe(true)

    const broken = new ThreadedPythonRuntime({ spawn: () => Promise.reject(new Error('no workers')) })
    await expect(broken.load()).rejects.toThrow('no workers')
    await expect(broken.load()).rejects.toThrow('no workers')
  })
})

describe('servePythonThread', () => {
  it('kills an interpreter asked to die before it started', async () => {
    const posted: unknown[] = []
    const channel: { listener: ((message: unknown) => void) | null } = { listener: null }
    const processes: EchoProcess[] = []
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    servePythonThread(
      {
        post: (message) => posted.push(message),
        onMessage: (listener) => {
          channel.listener = listener
        },
      },
      async () => {
        await gate
        return echoRuntime(processes)()
      },
    )
    channel.listener?.({ type: 'spawn', id: 1 })
    channel.listener?.({ type: 'kill', id: 1 })
    channel.listener?.('nonsense')
    release()
    for (let n = 0; n < 6; n++) await next()
    expect(processes[0].killed).toBe(true)
    expect(posted).toContainEqual({ type: 'exit', id: 1, exit: { kind: 'killed' } })
    expect(posted).not.toContainEqual({ type: 'spawned', id: 1 })
  })
})

describe('Python thread messages', () => {
  it('accepts only well-formed requests', () => {
    expect(parsePythonThreadRequest({ type: 'spawn', id: 1 })).toEqual({ type: 'spawn', id: 1 })
    expect(parsePythonThreadRequest({ type: 'kill', id: 2 })).toEqual({ type: 'kill', id: 2 })
    expect(parsePythonThreadRequest({ type: 'write', id: 1, text: 'x' })).toEqual({ type: 'write', id: 1, text: 'x' })
    for (const bad of [
      { type: 'write', id: 1 },
      { type: 'spawn', id: 0 },
      { type: 'spawn' },
      { type: 'x', id: 1 },
      5,
    ]) {
      expect(parsePythonThreadRequest(bad)).toBeNull()
    }
  })

  it('accepts only well-formed replies', () => {
    expect(parsePythonThreadReply({ type: 'ready' })).toEqual({ type: 'ready' })
    expect(parsePythonThreadReply({ type: 'load-failed', message: 'm' })).toEqual({ type: 'load-failed', message: 'm' })
    expect(parsePythonThreadReply({ type: 'spawned', id: 1 })).toEqual({ type: 'spawned', id: 1 })
    expect(parsePythonThreadReply({ type: 'spawn-failed', id: 1, message: 'm' })).toEqual({
      type: 'spawn-failed',
      id: 1,
      message: 'm',
    })
    expect(parsePythonThreadReply({ type: 'stdout', id: 1, line: 'a' })).toEqual({ type: 'stdout', id: 1, line: 'a' })
    expect(parsePythonThreadReply({ type: 'stderr', id: 1, line: 'a' })).toEqual({ type: 'stderr', id: 1, line: 'a' })
    for (const exit of [{ kind: 'killed' }, { kind: 'exited', code: 2 }, { kind: 'failed', reason: 'trap' }]) {
      expect(parsePythonThreadReply({ type: 'exit', id: 1, exit })).toEqual({ type: 'exit', id: 1, exit })
    }
    for (const bad of [
      { type: 'load-failed' },
      { type: 'spawned', id: -1 },
      { type: 'spawn-failed', id: 1 },
      { type: 'stdout', id: 1 },
      { type: 'exit', id: 1, exit: { kind: 'exited' } },
      { type: 'exit', id: 1, exit: { kind: 'failed' } },
      { type: 'exit', id: 1, exit: 'x' },
      { type: 'other' },
      null,
    ]) {
      expect(parsePythonThreadReply(bad)).toBeNull()
    }
  })
})
