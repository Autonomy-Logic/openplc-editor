import { afterEach, describe, expect, it } from '@jest/globals'

import {
  ClangWorkerPool,
  JOB_DEADLINE_MS,
  parseClangWorkerReply,
  WasmToolchainLoadError,
  WORKER_LOAD_DEADLINE_MS,
} from '../clang-worker-pool'
import {
  CountingClangMechanism,
  FakeClangWorker,
  flushMicrotasks,
  withoutDiscard,
} from './fixtures/counting-clang-mechanism'

const job = (source = 'a.c') => ({ argv: ['clang', '-c', source], tree: { [source]: 'int a;' } })

const succeed = () => ({ exitCode: 0, stderr: '', stdout: '', tree: {} })

/** Returns a probe that tells whether `promise` has settled. */
const settled = <T>(promise: Promise<T>): (() => boolean) => {
  let done = false
  void promise.then(
    () => (done = true),
    () => (done = true),
  )
  return () => done
}

/** Advances fake time in steps until `promise` settles, then returns it. */
async function advanceUntilSettled<T>(promise: Promise<T>, stepMs: number, steps = 10): Promise<T> {
  const done = settled(promise)
  for (let step = 0; step < steps && !done(); step++) {
    await jest.advanceTimersByTimeAsync(stepMs)
    await flushMicrotasks()
  }
  return promise
}

/** The message of a rejection reason, or an empty string. */
const messageOf = (reason: unknown): string => (reason instanceof Error ? reason.message : '')

const worker = (mechanism: CountingClangMechanism, index: number): FakeClangWorker => {
  const found = mechanism.workers[index]
  if (!found) throw new Error(`worker ${index} was never started`)
  return found
}

afterEach(() => {
  jest.useRealTimers()
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

describe('ClangWorkerPool prepare', () => {
  it('keeps both deadlines at 120 s and runs one job at a time', () => {
    expect(WORKER_LOAD_DEADLINE_MS).toBe(120_000)
    expect(JOB_DEADLINE_MS).toBe(120_000)
    expect(new ClangWorkerPool(new CountingClangMechanism()).concurrency).toBe(1)
  })

  it('gets the toolchain files ready without starting a worker', async () => {
    const mechanism = new CountingClangMechanism()
    const pool = new ClangWorkerPool(mechanism)

    await pool.prepare()
    await flushMicrotasks()

    expect(mechanism.loads).toBe(1)
    expect(mechanism.started).toBe(0)
  })

  it('keeps a successful prepare', async () => {
    const mechanism = new CountingClangMechanism()
    const pool = new ClangWorkerPool(mechanism)

    await pool.prepare()
    await pool.prepare()

    expect(mechanism.loads).toBe(1)
  })

  it('does not keep a failed prepare: the next call loads the files again', async () => {
    const mechanism = new CountingClangMechanism()
    mechanism.loadError = new Error('Missing toolchain file: /clang/gen/bundle.js')
    const pool = new ClangWorkerPool(mechanism)

    await expect(pool.prepare()).rejects.toThrow('Missing toolchain file: /clang/gen/bundle.js')
    mechanism.loadError = null
    await expect(pool.prepare()).resolves.toBeUndefined()

    expect(mechanism.loads).toBe(2)
    expect(mechanism.started).toBe(0)
  })

  it('shares one load between a prepare in flight and a run started meanwhile', async () => {
    const mechanism = new CountingClangMechanism()
    mechanism.answer = succeed
    mechanism.holdLoads = true
    const pool = new ClangWorkerPool(mechanism)

    const pageLoad = pool.prepare()
    const build = pool.run(job())
    await flushMicrotasks()

    expect(mechanism.loads).toBe(1)
    expect(mechanism.started).toBe(0)
    mechanism.holdLoads = false
    mechanism.settleLoads()
    await expect(pageLoad).resolves.toBeUndefined()
    await expect(build).resolves.toMatchObject({ exitCode: 0 })
    expect(mechanism.loads).toBe(1)
  })

  it('loads nothing again for a run after a job ran and release resolved', async () => {
    const mechanism = new CountingClangMechanism()
    mechanism.answer = succeed
    const pool = new ClangWorkerPool(mechanism)
    await pool.run(job('a.c'))
    await pool.release()

    await expect(pool.run(job('b.c'))).resolves.toMatchObject({ exitCode: 0 })

    expect(mechanism.loads).toBe(1)
    expect(mechanism.started).toBe(2)
  })
})

describe('ClangWorkerPool with one worker', () => {
  it('runs 12 queued jobs on one worker, one at a time and in order', async () => {
    const mechanism = new CountingClangMechanism()
    const pool = new ClangWorkerPool(mechanism)
    const sources = Array.from({ length: 12 }, (_, index) => `unit${index}.c`)

    const runs = sources.map((source) => pool.run(job(source)))
    for (let index = 0; index < sources.length; index++) {
      await flushMicrotasks()
      const only = worker(mechanism, 0)
      expect(only.posted).toHaveLength(index + 1)
      only.answerNext()
    }

    await expect(Promise.all(runs)).resolves.toHaveLength(12)
    expect(mechanism.started).toBe(1)
    expect(mechanism.maxAlive).toBe(1)
    expect(worker(mechanism, 0).posted.map((message) => message.argv[2])).toEqual(sources)
  })

  it('starts no more than one worker for 12 queued jobs where four used to start', async () => {
    const mechanism = new CountingClangMechanism()
    mechanism.answer = succeed
    const legacyOptions = { maxWorkers: 4, jobDeadlineMs: JOB_DEADLINE_MS }
    const pool = new ClangWorkerPool(mechanism, legacyOptions)

    await Promise.all(Array.from({ length: 12 }, (_, index) => pool.run(job(`unit${index}.c`))))

    expect(mechanism.maxAlive).toBe(1)
    expect(mechanism.started).toBe(1)
  })
})

describe('ClangWorkerPool release', () => {
  it('resolves at once when no worker is alive', async () => {
    const mechanism = new CountingClangMechanism()
    const pool = new ClangWorkerPool(mechanism)

    await expect(pool.release()).resolves.toBeUndefined()
    expect(mechanism.started).toBe(0)
  })

  it('ends the idle worker and resolves only once it has exited', async () => {
    const mechanism = new CountingClangMechanism()
    mechanism.answer = succeed
    mechanism.exitMode = 'manual'
    const pool = new ClangWorkerPool(mechanism)
    await pool.run(job())

    const release = pool.release()
    const released = settled(release)
    await flushMicrotasks()

    expect(worker(mechanism, 0).terminateCalls).toBe(1)
    expect(released()).toBe(false)
    expect(mechanism.alive).toBe(1)

    worker(mechanism, 0).exit()
    await release

    expect(mechanism.alive).toBe(0)
  })

  it('counts a worker whose terminate returns nothing as exited when the call returns', async () => {
    const mechanism = new CountingClangMechanism()
    mechanism.answer = succeed
    mechanism.exitMode = 'void'
    const pool = new ClangWorkerPool(mechanism)
    await pool.run(job())

    await pool.release()
    await expect(pool.run(job('b.c'))).resolves.toMatchObject({ exitCode: 0 })

    expect(mechanism.started).toBe(2)
    expect(mechanism.maxAlive).toBe(1)
  })

  it('ends nothing while a job is running or queued', async () => {
    const mechanism = new CountingClangMechanism()
    const pool = new ClangWorkerPool(mechanism)
    const running = pool.run(job('a.c'))
    const queued = pool.run(job('b.c'))
    await flushMicrotasks()

    const release = pool.release()
    await flushMicrotasks()

    const only = worker(mechanism, 0)
    expect(only.terminateCalls).toBe(0)
    only.answerNext()
    await expect(running).resolves.toMatchObject({ exitCode: 0 })
    await flushMicrotasks()
    expect(only.terminateCalls).toBe(0)
    expect(only.posted).toHaveLength(2)
    only.answerNext()
    await expect(queued).resolves.toMatchObject({ exitCode: 0 })
    expect(mechanism.started).toBe(1)
    await release
  })

  it('starts the next worker only after the released one has exited', async () => {
    const mechanism = new CountingClangMechanism()
    mechanism.answer = succeed
    mechanism.exitMode = 'manual'
    const pool = new ClangWorkerPool(mechanism)
    await pool.run(job('a.c'))
    const release = pool.release()
    await flushMicrotasks()

    const next = pool.run(job('b.c'))
    await flushMicrotasks()
    expect(mechanism.started).toBe(1)

    worker(mechanism, 0).exit()
    await release
    await expect(next).resolves.toMatchObject({ exitCode: 0 })

    expect(mechanism.started).toBe(2)
    expect(mechanism.maxAlive).toBe(1)
  })
})

describe('ClangWorkerPool failures after the worker loaded', () => {
  it('fails the running job with the reason, and starts a replacement for queued jobs only after the exit', async () => {
    const mechanism = new CountingClangMechanism()
    mechanism.exitMode = 'manual'
    const pool = new ClangWorkerPool(mechanism)
    const first = pool.run(job('a.c'))
    const second = pool.run(job('b.c'))
    await flushMicrotasks()

    worker(mechanism, 0).fail('exit code 3')
    await expect(first).rejects.toThrow('The compiler worker stopped (exit code 3).')
    await flushMicrotasks()
    expect(mechanism.started).toBe(1)

    worker(mechanism, 0).exit()
    await flushMicrotasks()
    expect(mechanism.started).toBe(2)
    worker(mechanism, 1).answerNext()

    await expect(second).resolves.toMatchObject({ exitCode: 0 })
    expect(mechanism.maxAlive).toBe(1)
  })

  it('does not report a failure after loading as a toolchain load failure', async () => {
    const mechanism = new CountingClangMechanism()
    const pool = new ClangWorkerPool(mechanism)
    const run = pool.run(job())
    await flushMicrotasks()

    worker(mechanism, 0).fail('exit code 3')

    const error = await run.catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(WasmToolchainLoadError)
  })

  it('rejects a job the worker reports it could not run, and ignores unknown replies', async () => {
    const mechanism = new CountingClangMechanism()
    const pool = new ClangWorkerPool(mechanism)
    const run = pool.run(job())
    await flushMicrotasks()
    const only = worker(mechanism, 0)

    only.send('noise')
    only.reply(999, succeed())
    only.send({ type: 'error', id: only.posted[0].id, message: 'out of memory' })

    await expect(run).rejects.toThrow('out of memory')
  })

  it('fails a job that runs past the default deadline with "a job ran longer than 120 s", and the worker exits', async () => {
    jest.useFakeTimers()
    const mechanism = new CountingClangMechanism()
    const pool = new ClangWorkerPool(mechanism)

    const error = await advanceUntilSettled(
      pool.run(job()).catch((reason: unknown) => reason),
      JOB_DEADLINE_MS,
    )

    expect(messageOf(error)).toBe('The compiler worker stopped (a job ran longer than 120 s).')
    await advanceUntilSettled(pool.release(), 1)
    expect(mechanism.alive).toBe(0)
  })

  it('keeps one worker alive while a worker stopped at the deadline exits late and jobs still wait', async () => {
    jest.useFakeTimers()
    const mechanism = new CountingClangMechanism()
    mechanism.exitMode = 'manual'
    const pool = new ClangWorkerPool(mechanism, { jobDeadlineMs: 5_000 })

    const stuck = pool.run(job('a.c')).catch((reason: unknown) => reason)
    const waiting = pool.run(job('b.c'))

    expect(messageOf(await advanceUntilSettled(stuck, 5_000))).toBe(
      'The compiler worker stopped (a job ran longer than 5 s).',
    )
    expect(worker(mechanism, 0).terminateCalls).toBeGreaterThan(0)
    await jest.advanceTimersByTimeAsync(10_000)
    await flushMicrotasks()
    expect(mechanism.started).toBe(1)

    worker(mechanism, 0).exit()
    await jest.advanceTimersByTimeAsync(0)
    await flushMicrotasks()
    expect(mechanism.started).toBe(2)
    worker(mechanism, 1).answerNext()

    await expect(waiting).resolves.toMatchObject({ exitCode: 0 })
    expect(mechanism.maxAlive).toBe(1)
  })
})

describe('ClangWorkerPool load failure', () => {
  it('rejects every queued job with WasmToolchainLoadError when the worker fails before it is ready', async () => {
    const mechanism = new CountingClangMechanism()
    mechanism.autoReady = false
    const pool = new ClangWorkerPool(mechanism)
    const first = pool.run(job('a.c')).catch((reason: unknown) => reason)
    const second = pool.run(job('b.c')).catch((reason: unknown) => reason)
    await flushMicrotasks()

    worker(mechanism, 0).fail('cannot load')

    for (const error of [await first, await second]) {
      expect(error).toBeInstanceOf(WasmToolchainLoadError)
      expect(error).toBeInstanceOf(Error)
      expect(messageOf(error)).toBe('The WebAssembly compiler could not be loaded: cannot load')
    }
    expect(mechanism.started).toBe(1)
  })

  it('rejects every run until release without starting another worker, then tries again', async () => {
    const mechanism = new CountingClangMechanism()
    mechanism.autoReady = false
    const pool = new ClangWorkerPool(mechanism)
    const first = pool.run(job('a.c')).catch((reason: unknown) => reason)
    await flushMicrotasks()
    worker(mechanism, 0).fail('cannot load')
    expect(await first).toBeInstanceOf(WasmToolchainLoadError)

    const later = await pool.run(job('b.c')).catch((reason: unknown) => reason)
    expect(later).toBeInstanceOf(WasmToolchainLoadError)
    expect(messageOf(later)).toBe('The WebAssembly compiler could not be loaded: cannot load')
    expect(mechanism.started).toBe(1)

    await pool.release()
    expect(mechanism.alive).toBe(0)
    mechanism.autoReady = true
    mechanism.answer = succeed

    await expect(pool.run(job('c.c'))).resolves.toMatchObject({ exitCode: 0 })
    expect(mechanism.started).toBe(2)
    expect(mechanism.maxAlive).toBe(1)
  })

  it('rejects every queued job with WasmToolchainLoadError when the worker cannot be started', async () => {
    const mechanism = new CountingClangMechanism()
    mechanism.spawnError = new Error('no threads')
    const pool = new ClangWorkerPool(mechanism)

    const errors = await Promise.all([
      pool.run(job('a.c')).catch((reason: unknown) => reason),
      pool.run(job('b.c')).catch((reason: unknown) => reason),
    ])

    for (const error of errors) {
      expect(error).toBeInstanceOf(WasmToolchainLoadError)
      expect(messageOf(error)).toBe(
        'The WebAssembly compiler could not be loaded: the compiler worker could not be started (no threads)',
      )
      expect(error instanceof WasmToolchainLoadError ? error.reason : '').toBe(
        'the compiler worker could not be started (no threads)',
      )
    }
    expect(mechanism.spawnAttempts).toBe(1)
  })

  it('rejects every run after a worker could not be started without trying again until release', async () => {
    const mechanism = new CountingClangMechanism()
    mechanism.spawnError = new Error('no threads')
    const pool = new ClangWorkerPool(mechanism)
    const first = await pool.run(job('a.c')).catch((reason: unknown) => reason)
    expect(first).toBeInstanceOf(WasmToolchainLoadError)

    const later = await pool.run(job('b.c')).catch((reason: unknown) => reason)

    expect(later).toBe(first)
    expect(mechanism.spawnAttempts).toBe(1)
    expect(mechanism.loads).toBe(1)

    await pool.release()
    mechanism.spawnError = null
    mechanism.answer = succeed

    await expect(pool.run(job('c.c'))).resolves.toMatchObject({ exitCode: 0 })
    expect(mechanism.spawnAttempts).toBe(2)
    expect(mechanism.started).toBe(1)
    expect(mechanism.loads).toBe(1)
  })

  it('reports a worker that does not load within 120 s as a toolchain load failure', async () => {
    jest.useFakeTimers()
    const mechanism = new CountingClangMechanism()
    mechanism.autoReady = false
    const pool = new ClangWorkerPool(mechanism)

    const error = await advanceUntilSettled(
      pool.run(job()).catch((reason: unknown) => reason),
      WORKER_LOAD_DEADLINE_MS,
    )

    expect(error).toBeInstanceOf(WasmToolchainLoadError)
    expect(messageOf(error)).toBe('The WebAssembly compiler could not be loaded: it did not load within 120 s')
    expect(mechanism.started).toBe(1)
  })
})

/** Starts a run on a worker that never reports ready, makes the worker fail, and returns the run's rejection. */
async function failBeforeReady(pool: ClangWorkerPool, mechanism: CountingClangMechanism): Promise<unknown> {
  mechanism.autoReady = false
  const run = pool.run(job('a.c')).catch((reason: unknown) => reason)
  await flushMicrotasks()
  worker(mechanism, 0).fail('cannot load')
  return run
}

describe('ClangWorkerPool stored files after a load failure', () => {
  it('discards the stored files once when the worker fails before ready, and fails every run until release', async () => {
    const mechanism = new CountingClangMechanism()
    mechanism.autoReady = false
    const pool = new ClangWorkerPool(mechanism)
    const first = pool.run(job('a.c')).catch((reason: unknown) => reason)
    const queued = pool.run(job('b.c')).catch((reason: unknown) => reason)
    await flushMicrotasks()

    worker(mechanism, 0).fail('cannot load')
    const later = await pool.run(job('c.c')).catch((reason: unknown) => reason)

    for (const error of [await first, await queued, later]) {
      expect(error).toBeInstanceOf(WasmToolchainLoadError)
      expect(messageOf(error)).toBe('The WebAssembly compiler could not be loaded: cannot load')
    }
    expect(mechanism.discards).toBe(1)
    expect(mechanism.loads).toBe(1)
  })

  it('after release, waits for the discard to settle, loads the files again and runs the job', async () => {
    const mechanism = new CountingClangMechanism()
    mechanism.holdDiscards = true
    const pool = new ClangWorkerPool(mechanism)
    expect(await failBeforeReady(pool, mechanism)).toBeInstanceOf(WasmToolchainLoadError)
    await pool.release()
    mechanism.autoReady = true
    mechanism.answer = succeed

    const next = pool.run(job('d.c'))
    await flushMicrotasks()

    expect(mechanism.loads).toBe(1)
    expect(mechanism.started).toBe(1)
    mechanism.settleDiscards()
    await expect(next).resolves.toMatchObject({ exitCode: 0 })
    expect(mechanism.loads).toBe(2)
    expect(mechanism.discards).toBe(1)
  })

  it.each([
    ['rejects', false],
    ['throws', true],
  ])('loads the files again after release when the discard %s', async (_label, throws) => {
    const mechanism = new CountingClangMechanism()
    mechanism.discardError = new Error('storage error')
    mechanism.discardThrows = throws
    const pool = new ClangWorkerPool(mechanism)
    expect(await failBeforeReady(pool, mechanism)).toBeInstanceOf(WasmToolchainLoadError)
    await pool.release()
    mechanism.autoReady = true
    mechanism.answer = succeed

    await expect(pool.run(job('d.c'))).resolves.toMatchObject({ exitCode: 0 })

    expect(mechanism.discards).toBe(1)
    expect(mechanism.loads).toBe(2)
  })

  it('loads the files again after release with a mechanism that has no discard', async () => {
    const mechanism = new CountingClangMechanism()
    const pool = new ClangWorkerPool(withoutDiscard(mechanism))
    expect(await failBeforeReady(pool, mechanism)).toBeInstanceOf(WasmToolchainLoadError)
    await pool.release()
    mechanism.autoReady = true
    mechanism.answer = succeed

    await expect(pool.run(job('d.c'))).resolves.toMatchObject({ exitCode: 0 })

    expect(mechanism.loads).toBe(2)
    expect(mechanism.discards).toBe(0)
  })

  it('neither discards nor loads again after a worker that missed the load deadline', async () => {
    jest.useFakeTimers()
    const mechanism = new CountingClangMechanism()
    mechanism.autoReady = false
    const pool = new ClangWorkerPool(mechanism, { loadDeadlineMs: 1_000 })

    const error = await advanceUntilSettled(
      pool.run(job()).catch((reason: unknown) => reason),
      1_000,
    )
    expect(messageOf(error)).toBe('The WebAssembly compiler could not be loaded: it did not load within 1 s')
    await advanceUntilSettled(pool.release(), 1)
    mechanism.autoReady = true
    mechanism.answer = succeed

    await expect(advanceUntilSettled(pool.run(job('b.c')), 1)).resolves.toMatchObject({ exitCode: 0 })
    expect(mechanism.discards).toBe(0)
    expect(mechanism.loads).toBe(1)
  })

  it('neither discards nor loads again after a job ran past its deadline', async () => {
    jest.useFakeTimers()
    const mechanism = new CountingClangMechanism()
    const pool = new ClangWorkerPool(mechanism, { jobDeadlineMs: 1_000 })

    const error = await advanceUntilSettled(
      pool.run(job()).catch((reason: unknown) => reason),
      1_000,
    )
    expect(messageOf(error)).toBe('The compiler worker stopped (a job ran longer than 1 s).')
    await advanceUntilSettled(pool.release(), 1)
    mechanism.answer = succeed

    await expect(advanceUntilSettled(pool.run(job('b.c')), 1)).resolves.toMatchObject({ exitCode: 0 })
    expect(mechanism.discards).toBe(0)
    expect(mechanism.loads).toBe(1)
  })

  it('neither discards nor loads again after the worker fails once it is ready', async () => {
    const mechanism = new CountingClangMechanism()
    const pool = new ClangWorkerPool(mechanism)
    const run = pool.run(job()).catch((reason: unknown) => reason)
    await flushMicrotasks()

    worker(mechanism, 0).fail('exit code 3')
    expect(messageOf(await run)).toBe('The compiler worker stopped (exit code 3).')
    await pool.release()
    mechanism.answer = succeed

    await expect(pool.run(job('b.c'))).resolves.toMatchObject({ exitCode: 0 })
    expect(mechanism.discards).toBe(0)
    expect(mechanism.loads).toBe(1)
  })

  it('neither discards nor loads again after the worker could not be started', async () => {
    const mechanism = new CountingClangMechanism()
    mechanism.spawnError = new Error('no threads')
    const pool = new ClangWorkerPool(mechanism)
    expect(await pool.run(job()).catch((reason: unknown) => reason)).toBeInstanceOf(WasmToolchainLoadError)
    await pool.release()
    mechanism.spawnError = null
    mechanism.answer = succeed

    await expect(pool.run(job('b.c'))).resolves.toMatchObject({ exitCode: 0 })
    expect(mechanism.discards).toBe(0)
    expect(mechanism.loads).toBe(1)
  })
})
