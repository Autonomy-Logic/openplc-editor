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
  busy: boolean[] = []
  postError: Error | null = null
  terminateError: Error | null = null
  private messageListeners: Array<(raw: unknown) => void> = []
  private failureListeners: Array<(reason: string) => void> = []

  post(message: ClangWorkerJobMessage): void {
    if (this.postError) throw this.postError
    this.posted.push(message)
  }
  setBusy(busy: boolean): void {
    this.busy.push(busy)
  }
  onMessage(listener: (raw: unknown) => void): void {
    this.messageListeners.push(listener)
  }
  onFailure(listener: (reason: string) => void): void {
    this.failureListeners.push(listener)
  }
  terminate(): Promise<void> {
    this.terminated = true
    return this.terminateError ? Promise.reject(this.terminateError) : Promise.resolve()
  }
  send(raw: unknown): void {
    for (const l of this.messageListeners) l(raw)
  }
  fail(reason: string): void {
    for (const l of this.failureListeners) l(reason)
  }
  answer(id: number, exitCode = 0): void {
    this.send({ type: 'result', id, result: { exitCode, stderr: '', stdout: '', tree: {} } })
  }
}

class FakeMechanism implements ClangWorkerMechanism {
  workers: FakeWorker[] = []
  loads = 0
  spawnError: Error | null = null
  constructor(
    public autoReady = true,
    private readonly missing: Error | null = null,
  ) {}
  load(): Promise<void> {
    this.loads++
    return this.missing ? Promise.reject(this.missing) : Promise.resolve()
  }
  spawn(): ClangWorkerHandle {
    if (this.spawnError) throw this.spawnError
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
    expect(
      parseClangWorkerReply({ type: 'result', id: 2, result: { exitCode: 1, stderr: 's', stdout: 'o', tree: {} } }),
    ).toEqual({
      type: 'result',
      id: 2,
      result: { exitCode: 1, stderr: 's', stdout: 'o', tree: {} },
    })
  })

  it.each([
    null,
    'ready',
    { type: 'result' },
    { type: 'error', id: 1 },
    { type: 'result', id: 1, result: { exitCode: '0', stderr: '', stdout: '', tree: {} } },
    { type: 'result', id: 1, result: { exitCode: 0, stderr: '', tree: {} } },
    { type: 'result', id: 1, result: { exitCode: 0, stderr: '', stdout: '', tree: new Uint8Array(1) } },
    { type: 'other', id: 1 },
  ])('rejects %j', (value) => {
    expect(parseClangWorkerReply(value)).toBeNull()
  })
})

describe('ClangWorkerPool', () => {
  const pool = (mechanism: FakeMechanism, maxWorkers = 2, deadlines: { load?: number; job?: number } = {}) =>
    new ClangWorkerPool(mechanism, { maxWorkers, loadDeadlineMs: deadlines.load, jobDeadlineMs: deadlines.job })

  it('loads the toolchain once and starts with one worker', async () => {
    const mechanism = new FakeMechanism()
    const p = pool(mechanism, 4)
    await Promise.all([p.prepare(), p.prepare()])
    expect(mechanism.loads).toBe(1)
    expect(mechanism.workers).toHaveLength(1)
    expect(p.concurrency).toBe(4)
  })

  it('reuses an idle worker instead of starting another', async () => {
    const mechanism = new FakeMechanism()
    const p = pool(mechanism, 4)
    const first = p.run(job)
    await flush()
    const [w] = mechanism.workers
    w.answer(w.posted[0].id)
    await first
    const second = p.run(job)
    await flush()
    w.answer(w.posted[1].id)
    await second
    expect(mechanism.workers).toHaveLength(1)
  })

  it('adds a worker while jobs wait, up to the maximum, and runs one job per worker', async () => {
    const mechanism = new FakeMechanism()
    const p = pool(mechanism, 2)
    const runs = [p.run(job), p.run(job), p.run(job)]
    await flush()
    expect(mechanism.workers).toHaveLength(2)
    const [a, b] = mechanism.workers
    expect(a.posted).toHaveLength(1)
    expect(b.posted).toHaveLength(1)

    a.answer(a.posted[0].id)
    await flush()
    expect(a.posted).toHaveLength(2)
    expect(b.posted).toHaveLength(1)
    a.answer(a.posted[1].id)
    b.answer(b.posted[0].id)
    await expect(Promise.all(runs)).resolves.toHaveLength(3)
  })

  it("starts a waiting job's deadline when a worker takes it, not when it was queued", async () => {
    const mechanism = new FakeMechanism()
    const p = pool(mechanism, 1, { job: 60 })
    const first = p.run(job)
    const second = p.run(job)
    await flush()
    const [w] = mechanism.workers
    await new Promise((r) => setTimeout(r, 40))
    w.answer(w.posted[0].id)
    await first
    await new Promise((r) => setTimeout(r, 40))
    w.answer(w.posted[1].id)
    await expect(second).resolves.toMatchObject({ exitCode: 0 })
    expect(w.terminated).toBe(false)
  })

  it('tells the worker when it is busy and when it is idle', async () => {
    const mechanism = new FakeMechanism()
    const p = pool(mechanism, 1)
    const run = p.run(job)
    await flush()
    const [w] = mechanism.workers
    w.answer(w.posted[0].id)
    await run
    expect(w.busy).toEqual([false, true, false])
  })

  it('fails only the job a worker could not be handed, and keeps the worker', async () => {
    const mechanism = new FakeMechanism()
    const p = pool(mechanism, 1)
    await p.prepare()
    const [w] = mechanism.workers
    w.postError = new Error('could not clone the job')
    await expect(p.run(job)).rejects.toThrow('could not clone the job')
    w.postError = null
    const next = p.run(job)
    await flush()
    w.answer(w.posted[0].id)
    await expect(next).resolves.toMatchObject({ exitCode: 0 })
    expect(mechanism.workers).toHaveLength(1)
  })

  it('rejects a job the worker reports it could not run, and ignores unknown replies', async () => {
    const mechanism = new FakeMechanism()
    const p = pool(mechanism, 1)
    const run = p.run(job)
    await flush()
    const [w] = mechanism.workers
    w.send('noise')
    w.answer(999)
    w.send({ type: 'error', id: w.posted[0].id, message: 'out of memory' })
    await expect(run).rejects.toThrow('out of memory')
  })

  it('fails prepare when the toolchain files cannot be loaded, without starting workers', async () => {
    const mechanism = new FakeMechanism(true, new Error('bundle.js not found'))
    await expect(pool(mechanism).prepare()).rejects.toThrow('bundle.js not found')
    expect(mechanism.workers).toHaveLength(0)
  })

  it('fails prepare when the first worker fails while loading, terminates it, and can try again', async () => {
    const mechanism = new FakeMechanism(false)
    const p = pool(mechanism, 1)
    const prepare = p.prepare()
    await flush()
    mechanism.workers[0].fail('cannot load')
    mechanism.workers[0].fail('exit code 1')
    await expect(prepare).rejects.toThrow('The compiler worker stopped (cannot load).')
    expect(mechanism.workers[0].terminated).toBe(true)

    const retry = p.prepare()
    await flush()
    mechanism.workers[1].send({ type: 'ready' })
    await expect(retry).resolves.toBeUndefined()
  })

  it('keeps the reason loading failed when stopping the workers also fails', async () => {
    const mechanism = new FakeMechanism(false)
    const p = pool(mechanism, 1)
    const prepare = p.prepare()
    await flush()
    mechanism.workers[0].terminateError = new Error('terminate failed')
    mechanism.workers[0].fail('cannot load')
    await expect(prepare).rejects.toThrow('The compiler worker stopped (cannot load).')
  })

  it('fails prepare when the first worker does not load in time', async () => {
    const mechanism = new FakeMechanism(false)
    await expect(pool(mechanism, 1, { load: 20 }).prepare()).rejects.toThrow(
      'The compiler worker stopped (it did not load within 0 s).',
    )
    expect(mechanism.workers[0].terminated).toBe(true)
  })

  it('fails the jobs of a worker that stops, terminates it, and starts a fresh one for the next job', async () => {
    const mechanism = new FakeMechanism()
    const p = pool(mechanism, 1)
    const run = p.run(job)
    await flush()
    mechanism.workers[0].fail('exit code 3')
    await expect(run).rejects.toThrow('The compiler worker stopped (exit code 3).')
    expect(mechanism.workers[0].terminated).toBe(true)

    const next = p.run(job)
    await flush()
    expect(mechanism.workers).toHaveLength(2)
    const fresh = mechanism.workers[1]
    fresh.answer(fresh.posted[0].id)
    await expect(next).resolves.toMatchObject({ exitCode: 0 })
  })

  it('fails waiting jobs when a new worker fails while loading and no loaded worker is left', async () => {
    const mechanism = new FakeMechanism()
    const p = pool(mechanism, 1)
    const first = p.run(job)
    await flush()
    mechanism.workers[0].fail('exit code 3')
    await expect(first).rejects.toThrow('exit code 3')

    mechanism.autoReady = false
    const second = p.run(job)
    await flush()
    mechanism.workers[1].fail('out of memory while loading')
    await expect(second).rejects.toThrow('The compiler worker stopped (out of memory while loading).')
    expect(mechanism.workers[1].terminated).toBe(true)

    mechanism.autoReady = true
    const third = p.run(job)
    await flush()
    expect(mechanism.workers).toHaveLength(3)
    mechanism.workers[2].answer(mechanism.workers[2].posted[0].id)
    await expect(third).resolves.toMatchObject({ exitCode: 0 })
  })

  it('keeps waiting jobs for the loaded worker when another worker cannot be started', async () => {
    const mechanism = new FakeMechanism()
    const p = pool(mechanism, 2)
    const first = p.run(job)
    await flush()
    mechanism.spawnError = new Error('blocked by policy')
    const second = p.run(job)
    await flush()
    expect(mechanism.workers).toHaveLength(1)

    const worker = mechanism.workers[0]
    worker.answer(worker.posted[0].id)
    await expect(first).resolves.toMatchObject({ exitCode: 0 })
    await flush()
    worker.answer(worker.posted[1].id)
    await expect(second).resolves.toMatchObject({ exitCode: 0 })
  })

  it('fails waiting jobs when a worker cannot be started and none is left, and recovers later', async () => {
    const mechanism = new FakeMechanism()
    const p = pool(mechanism, 1)
    const first = p.run(job)
    await flush()
    mechanism.workers[0].fail('exit code 3')
    await expect(first).rejects.toThrow('exit code 3')

    mechanism.spawnError = new Error('blocked by policy')
    await expect(p.run(job)).rejects.toThrow('The compiler worker could not be started (blocked by policy).')

    mechanism.spawnError = null
    const third = p.run(job)
    await flush()
    const fresh = mechanism.workers[1]
    expect(fresh.posted).toHaveLength(1)
    fresh.answer(fresh.posted[0].id)
    await expect(third).resolves.toMatchObject({ exitCode: 0 })
  })

  it('fails a job that runs past its deadline and terminates its worker', async () => {
    const mechanism = new FakeMechanism()
    const p = pool(mechanism, 1, { job: 20 })
    const run = p.run(job)
    await expect(run).rejects.toThrow('The compiler worker stopped (a job ran longer than 0 s).')
    expect(mechanism.workers[0].terminated).toBe(true)
  })

  it('terminate stops the workers and fails pending jobs', async () => {
    const mechanism = new FakeMechanism()
    const p = pool(mechanism, 1)
    const run = p.run(job)
    await flush()
    await p.terminate()
    await expect(run).rejects.toThrow('The compiler was stopped.')
    expect(mechanism.workers[0].terminated).toBe(true)
  })
})
