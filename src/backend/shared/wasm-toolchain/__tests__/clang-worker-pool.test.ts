import { describe, expect, it } from '@jest/globals'

import type {
  ClangWorkerHandle,
  ClangWorkerJobMessage,
  ClangWorkerMechanism,
} from '@root/middleware/shared/ports/wasm-toolchain-mechanisms'

import { ClangWorkerPool, clangWorkerCount, parseClangWorkerReply } from '../clang-worker-pool'

/** An in-memory worker the test drives by hand. */
class FakeWorker implements ClangWorkerHandle {
  posted: ClangWorkerJobMessage[] = []
  terminated = false
  private messageListeners: Array<(raw: unknown) => void> = []
  private failureListeners: Array<(reason: string) => void> = []

  post(message: ClangWorkerJobMessage): void {
    this.posted.push(message)
  }
  onMessage(listener: (raw: unknown) => void): void {
    this.messageListeners.push(listener)
  }
  onFailure(listener: (reason: string) => void): void {
    this.failureListeners.push(listener)
  }
  terminate(): void {
    this.terminated = true
  }
  send(raw: unknown): void {
    for (const l of this.messageListeners) l(raw)
  }
  fail(reason: string): void {
    for (const l of this.failureListeners) l(reason)
  }
  answer(id: number, exitCode = 0): void {
    this.send({ type: 'result', id, result: { exitCode, stderr: '', tree: {} } })
  }
}

class FakeMechanism implements ClangWorkerMechanism {
  workers: FakeWorker[] = []
  constructor(
    private readonly autoReady = true,
    private readonly missing: Error | null = null,
  ) {}
  load(): Promise<void> {
    return this.missing ? Promise.reject(this.missing) : Promise.resolve()
  }
  spawn(): ClangWorkerHandle {
    const worker = new FakeWorker()
    this.workers.push(worker)
    if (this.autoReady) queueMicrotask(() => worker.send({ type: 'ready' }))
    return worker
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))
const job = { argv: ['clang', '-c', 'a.c'], tree: { 'a.c': 'int a;' } }

describe('clangWorkerCount', () => {
  it.each([
    [1, 1],
    [2, 1],
    [4, 3],
    [5, 4],
    [16, 4],
    [undefined, 1],
    [0, 1],
  ])('%s cores -> %i workers', (cores, workers) => {
    expect(clangWorkerCount(cores)).toBe(workers)
  })
})

describe('parseClangWorkerReply', () => {
  it('accepts the three replies', () => {
    expect(parseClangWorkerReply({ type: 'ready' })).toEqual({ type: 'ready' })
    expect(parseClangWorkerReply({ type: 'error', id: 1, message: 'm' })).toEqual({
      type: 'error',
      id: 1,
      message: 'm',
    })
    expect(parseClangWorkerReply({ type: 'result', id: 2, result: { exitCode: 1, stderr: 's', tree: {} } })).toEqual({
      type: 'result',
      id: 2,
      result: { exitCode: 1, stderr: 's', tree: {} },
    })
  })

  it.each([
    null,
    'ready',
    { type: 'result' },
    { type: 'error', id: 1 },
    { type: 'result', id: 1, result: { exitCode: '0', stderr: '', tree: {} } },
    { type: 'result', id: 1, result: { exitCode: 0, stderr: '', tree: new Uint8Array(1) } },
    { type: 'other', id: 1 },
  ])('rejects %j', (value) => {
    expect(parseClangWorkerReply(value)).toBeNull()
  })
})

describe('ClangWorkerPool', () => {
  it('starts its workers once and resolves when all are ready', async () => {
    const mechanism = new FakeMechanism()
    const pool = new ClangWorkerPool(mechanism, 3)
    await Promise.all([pool.prepare(), pool.prepare()])
    expect(mechanism.workers).toHaveLength(3)
  })

  it('sends each job to the worker with the fewest pending and resolves with its result', async () => {
    const mechanism = new FakeMechanism()
    const pool = new ClangWorkerPool(mechanism, 2)
    const first = pool.run(job)
    const second = pool.run(job)
    await flush()
    const [a, b] = mechanism.workers
    expect(a.posted).toHaveLength(1)
    expect(b.posted).toHaveLength(1)
    a.answer(a.posted[0].id)
    b.answer(b.posted[0].id, 1)
    await expect(first).resolves.toEqual({ exitCode: 0, stderr: '', tree: {} })
    await expect(second).resolves.toMatchObject({ exitCode: 1 })
  })

  it('rejects a job the worker reports it could not run, and ignores unknown replies', async () => {
    const mechanism = new FakeMechanism()
    const pool = new ClangWorkerPool(mechanism, 1)
    const run = pool.run(job)
    await flush()
    const [w] = mechanism.workers
    w.send('noise')
    w.answer(999)
    w.send({ type: 'error', id: w.posted[0].id, message: 'out of memory' })
    await expect(run).rejects.toThrow('out of memory')
  })

  it('fails prepare when the toolchain is missing, without starting workers', async () => {
    const mechanism = new FakeMechanism(true, new Error('bundle.js not found'))
    const pool = new ClangWorkerPool(mechanism, 2)
    await expect(pool.prepare()).rejects.toThrow('bundle.js not found')
    expect(mechanism.workers).toHaveLength(0)
  })

  it('fails prepare when a worker stops while loading, does not replace it, and can try again', async () => {
    const mechanism = new FakeMechanism(false)
    const pool = new ClangWorkerPool(mechanism, 1)
    const prepare = pool.prepare()
    await flush()
    mechanism.workers[0].fail('cannot load')
    mechanism.workers[0].fail('exit code 1')
    await expect(prepare).rejects.toThrow('The compiler worker stopped (cannot load).')
    expect(mechanism.workers).toHaveLength(1)
    expect(mechanism.workers[0].terminated).toBe(true)

    const retry = pool.prepare()
    await flush()
    mechanism.workers[1].send({ type: 'ready' })
    await expect(retry).resolves.toBeUndefined()
  })

  it('fails the jobs of a worker that stops after loading and replaces it', async () => {
    const mechanism = new FakeMechanism()
    const pool = new ClangWorkerPool(mechanism, 1)
    const run = pool.run(job)
    await flush()
    mechanism.workers[0].fail('exit code 3')
    await expect(run).rejects.toThrow('The compiler worker stopped (exit code 3).')
    expect(mechanism.workers).toHaveLength(2)

    const next = pool.run(job)
    await flush()
    const replacement = mechanism.workers[1]
    replacement.answer(replacement.posted[0].id)
    await expect(next).resolves.toMatchObject({ exitCode: 0 })
  })

  it('terminate stops the workers and fails pending jobs', async () => {
    const mechanism = new FakeMechanism()
    const pool = new ClangWorkerPool(mechanism, 1)
    const run = pool.run(job)
    await flush()
    await pool.terminate()
    await expect(run).rejects.toThrow('The compiler was stopped.')
    expect(mechanism.workers[0].terminated).toBe(true)
  })
})
