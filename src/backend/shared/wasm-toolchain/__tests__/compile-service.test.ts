import { describe, expect, it } from '@jest/globals'

import type { WasmClangRunner } from '@root/middleware/shared/ports/wasm-toolchain-mechanisms'

import { ClangWorkerPool, JOB_DEADLINE_MS } from '../clang-worker-pool'
import { type CachedWasmObject, compileToWasm } from '../compile-to-wasm'
import { parseWasmCompileRequest } from '../parse-wasm-compile-request'
import { createWasmCompileService } from '../wasm-compile-service'
import { BoundedWasmObjectCache } from '../wasm-object-cache'
import { CountingClangMechanism, flushMicrotasks } from './fixtures/counting-clang-mechanism'
import { FakeRunner } from './fixtures/fake-runner'

const bytes = (n: number): CachedWasmObject => ({ object: new Uint8Array(n), dependencies: [['a.c', 'digest']] })

describe('BoundedWasmObjectCache', () => {
  it('stores and returns objects with their dependencies', () => {
    const cache = new BoundedWasmObjectCache(100)
    const entry = bytes(10)
    cache.set('a', entry)
    expect(cache.get('a')).toBe(entry)
    expect(cache.get('missing')).toBeUndefined()
    expect(cache.size).toBe(1)
    expect(cache.totalBytes).toBe(10)
  })

  it('evicts the least recently used objects when over budget', () => {
    const cache = new BoundedWasmObjectCache(30)
    cache.set('a', bytes(10)).set('b', bytes(10)).set('c', bytes(10))
    cache.get('a')
    cache.set('d', bytes(10))
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBeDefined()
    expect(cache.get('c')).toBeDefined()
    expect(cache.get('d')).toBeDefined()
    expect(cache.totalBytes).toBe(30)
  })

  it('replaces an entry and keeps the byte count right', () => {
    const cache = new BoundedWasmObjectCache(100)
    cache.set('a', bytes(40)).set('a', bytes(5))
    expect(cache.size).toBe(1)
    expect(cache.totalBytes).toBe(5)
  })

  it('never keeps an object larger than the budget', () => {
    const cache = new BoundedWasmObjectCache(10)
    cache.set('a', bytes(5)).set('huge', bytes(11))
    expect(cache.get('huge')).toBeUndefined()
    expect(cache.get('a')).toBeDefined()
  })
})

describe('createWasmCompileService', () => {
  const request = {
    files: { 'a.c': 'int a;', 'b.c': 'int b;' },
    units: [
      { source: 'a.c', language: 'c' as const },
      { source: 'b.c', language: 'c' as const },
    ],
  }

  it('prepares the runner once and reports readiness', async () => {
    const runner = new FakeRunner()
    const service = createWasmCompileService(runner)
    const [first, second] = await Promise.all([service.prepare(), service.prepare()])
    expect(first.ok).toBe(true)
    expect(second).toBe(first)
    expect(runner.prepared).toBe(1)
  })

  it('keeps one object cache across compiles', async () => {
    const runner = new FakeRunner()
    const service = createWasmCompileService(runner)
    await service.compile(request)
    const again = await service.compile(request)
    expect(again.stats.cached).toBe(2)
  })

  it('compiles a request from across a boundary, and refuses a malformed one without running clang', async () => {
    const runner = new FakeRunner()
    const service = createWasmCompileService(runner)
    expect((await service.compileRequest(request)).ok).toBe(true)
    const refused = await service.compileRequest({ files: 'nope', units: [] })
    expect(refused).toMatchObject({
      ok: false,
      error: "'files' must be an object of path to content.",
      diagnostics: [{ message: "'files' must be an object of path to content.", level: 'error' }],
    })
    expect(runner.jobs).toHaveLength(3)
  })

  it('forwards diagnostics to the log it is given', async () => {
    const runner = new FakeRunner(2, () => ({ exitCode: 1, stderr: 'a.c:1:1: error: bad\n' }))
    const service = createWasmCompileService(runner)
    const log: Array<[string, string]> = []
    const result = await service.compile(request, (m, l) => log.push([m, l]))
    expect(result.ok).toBe(false)
    expect(log[0]).toEqual(['a.c:1:1: error: bad', 'error'])
  })
})

describe('compileToWasm diagnostics', () => {
  it('returns every message it logged', async () => {
    const runner = new FakeRunner(2, (argv) =>
      argv.includes('a.c') ? { exitCode: 0, stderr: 'a.c:1:1: warning: w\n' } : { exitCode: 0 },
    )
    const result = await compileToWasm({ files: { 'a.c': 'x' }, units: [{ source: 'a.c', language: 'c' }] }, { runner })
    expect(result.diagnostics).toEqual([{ message: 'a.c:1:1: warning: w', level: 'warning' }])
  })
})

describe('parseWasmCompileRequest', () => {
  it('accepts a full request, with any byte view', () => {
    const view = new DataView(new ArrayBuffer(4), 1, 2)
    const parsed = parseWasmCompileRequest({
      files: { 'a.c': 'int a;', 'blob.bin': view },
      units: [{ source: 'a.c', language: 'c', flags: ['-O2'] }],
      cFlags: ['-std=c99'],
      cxxFlags: [],
      linkFlags: ['-mexec-model=reactor'],
      output: 'out.wasm',
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.request.units).toEqual([{ source: 'a.c', language: 'c', flags: ['-O2'] }])
    const blob = parsed.request.files['blob.bin']
    expect(blob).toBeInstanceOf(Uint8Array)
    expect(ArrayBuffer.isView(blob) && blob.byteLength).toBe(2)
    expect(parsed.request).toMatchObject({ cFlags: ['-std=c99'], cxxFlags: [], linkFlags: ['-mexec-model=reactor'] })
    expect(parsed.request.output).toBe('out.wasm')
  })

  it('refuses an own __proto__ key instead of applying it', () => {
    const files: unknown = JSON.parse('{"__proto__": "int x;"}')
    expect(parseWasmCompileRequest({ files, units: [] })).toEqual({
      ok: false,
      error: "Invalid toolchain file path '__proto__': '__proto__' is not allowed.",
    })
  })

  it('leaves optional fields out when absent', () => {
    const parsed = parseWasmCompileRequest({ files: {}, units: [{ source: 'a.c', language: 'c++' }] })
    expect(parsed).toMatchObject({ ok: true, request: { units: [{ source: 'a.c', language: 'c++' }] } })
    if (parsed.ok) expect(Object.keys(parsed.request)).toEqual(['files', 'units'])
  })

  it.each([
    [null, 'The compile request must be an object.'],
    [{ files: [], units: [] }, "'files' must be an object of path to content."],
    [{ files: { 'a.c': 1 }, units: [] }, "File 'a.c' must be text or bytes."],
    [{ files: {}, units: {} }, "'units' must be a list."],
    [{ files: {}, units: [{ language: 'c' }] }, 'Every unit needs a source path.'],
    [{ files: {}, units: [{ source: 'a.c', language: 'rust' }] }, "Unit 'a.c' has no valid language."],
    [{ files: {}, units: [{ source: 'a.c', language: 'c', flags: [1] }] }, "'a.c.flags' must be a list of strings."],
    [{ files: {}, units: [], cxxFlags: 'x' }, "'cxxFlags' must be a list of strings."],
    [{ files: {}, units: [], output: 3 }, "'output' must be a path."],
  ])('rejects %j', (value, error) => {
    expect(parseWasmCompileRequest(value)).toEqual({ ok: false, error })
  })
})

describe('createWasmCompileService over one clang worker', () => {
  const units = (count: number) => {
    const files: Record<string, string> = {}
    const list: Array<{ source: string; language: 'c' }> = []
    for (let index = 0; index < count; index++) {
      files[`u${index}.c`] = `int u${index};`
      list.push({ source: `u${index}.c`, language: 'c' })
    }
    return { files, units: list }
  }

  const setup = (outcome?: ConstructorParameters<typeof FakeRunner>[1]) => {
    const mechanism = new CountingClangMechanism()
    const clang = new FakeRunner(1, outcome)
    mechanism.answer = (job) => clang.run(job)
    const service = createWasmCompileService(new ClangWorkerPool(mechanism))
    return { mechanism, service }
  }

  const compileJobs = (mechanism: CountingClangMechanism): string[] =>
    mechanism.workers.flatMap((w) =>
      w.posted.filter((m) => m.argv.includes('-c')).map((m) => m.argv[m.argv.indexOf('-c') + 1]),
    )

  it('prepares the toolchain files without starting a worker', async () => {
    const { mechanism, service } = setup()

    const readiness = await service.prepare()
    await flushMicrotasks()

    expect(readiness.ok).toBe(true)
    expect(mechanism.loads).toBe(1)
    expect(mechanism.started).toBe(0)
  })

  it('does not keep a failed prepare, so the next call tries again', async () => {
    const { mechanism, service } = setup()
    mechanism.loadError = new Error('Missing toolchain file: /clang/gen/llvm.core.wasm')

    await expect(service.prepare()).resolves.toEqual({
      ok: false,
      message: 'The WebAssembly compiler could not be loaded: Missing toolchain file: /clang/gen/llvm.core.wasm',
    })
    mechanism.loadError = null
    const retried = await service.prepare()

    expect(retried.ok).toBe(true)
    expect(mechanism.loads).toBe(2)
    expect(mechanism.started).toBe(0)
  })

  it('leaves no clang worker alive once a successful build resolves', async () => {
    const { mechanism, service } = setup()

    const result = await service.compile(units(3))

    expect(result.ok).toBe(true)
    expect(mechanism.started).toBeGreaterThan(0)
    expect(mechanism.alive).toBe(0)
    expect(mechanism.maxAlive).toBe(1)
  })

  it('resolves a build only after its worker has exited', async () => {
    const { mechanism, service } = setup()
    mechanism.exitMode = 'manual'

    const build = service.compile(units(2))
    let resolved = false
    void build.then(() => (resolved = true))
    for (let round = 0; round < 200 && !mechanism.workers.some((w) => w.terminateCalls > 0); round++) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }

    expect(mechanism.workers[0]?.terminateCalls).toBe(1)
    await flushMicrotasks()
    expect(resolved).toBe(false)

    mechanism.workers[0]?.exit()
    await expect(build).resolves.toMatchObject({ ok: true })
    expect(mechanism.alive).toBe(0)
  })

  it('leaves no clang worker alive once a build that does not compile resolves', async () => {
    const { mechanism, service } = setup((argv) =>
      argv.includes('u1.c') ? { exitCode: 1, stderr: 'u1.c:1:9: error: expected expression\n' } : { exitCode: 0 },
    )

    const result = await service.compile(units(3))

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.error).toMatch(/^Compilation failed in 1 of 3 file\(s\)/)
    expect(result.diagnostics).toContainEqual({ message: 'u1.c:1:9: error: expected expression', level: 'error' })
    expect(mechanism.alive).toBe(0)
    expect(mechanism.maxAlive).toBe(1)
  })

  it('fails a build stuck past the job deadline with that reason, and leaves no clang worker alive', async () => {
    jest.useFakeTimers()
    try {
      const mechanism = new CountingClangMechanism()
      mechanism.answer = () => 'never'
      const service = createWasmCompileService(new ClangWorkerPool(mechanism))

      const build = service.compile(units(2))
      let done = false
      void build.then(() => (done = true))
      for (let step = 0; step < 10 && !done; step++) {
        await jest.advanceTimersByTimeAsync(JOB_DEADLINE_MS)
        await flushMicrotasks()
      }
      const result = await build

      expect(result.ok).toBe(false)
      expect(result.diagnostics).toContainEqual({
        message: 'The compiler worker stopped (a job ran longer than 120 s).',
        level: 'error',
      })
      expect(mechanism.alive).toBe(0)
      expect(mechanism.maxAlive).toBe(1)
    } finally {
      jest.useRealTimers()
    }
  })

  it('fails a build whose toolchain cannot load with that reason, leaves no worker alive, and retries next build', async () => {
    const { mechanism, service } = setup()
    mechanism.autoReady = false
    const build = service.compile(units(2))
    for (let round = 0; round < 200 && mechanism.started === 0; round++) await flushMicrotasks()
    mechanism.workers[0]?.fail('the toolchain bundle could not be read')

    const result = await build

    expect(result).toMatchObject({
      ok: false,
      error: 'The WebAssembly compiler could not be loaded: the toolchain bundle could not be read',
    })
    expect(result.diagnostics).toContainEqual({
      message: 'The WebAssembly compiler could not be loaded: the toolchain bundle could not be read',
      level: 'error',
    })
    expect(mechanism.started).toBe(1)
    expect(mechanism.alive).toBe(0)

    mechanism.autoReady = true
    await expect(service.compile(units(2))).resolves.toMatchObject({ ok: true })
    expect(mechanism.alive).toBe(0)
  })

  it('fails a build whose worker cannot be started once, with no per-file failure and no link, and retries next build', async () => {
    const mechanism = new CountingClangMechanism()
    const clang = new FakeRunner(1)
    mechanism.answer = (job) => clang.run(job)
    mechanism.spawnError = new Error('no threads')
    const pool = new ClangWorkerPool(mechanism)
    const requested: string[][] = []
    const runner: WasmClangRunner = {
      concurrency: pool.concurrency,
      prepare: () => pool.prepare(),
      run: (job) => {
        requested.push(job.argv)
        return pool.run(job)
      },
      release: () => pool.release(),
    }
    const service = createWasmCompileService(runner)
    const message =
      'The WebAssembly compiler could not be loaded: the compiler worker could not be started (no threads)'

    const result = await service.compile(units(3))

    expect(result).toMatchObject({ ok: false, error: message })
    expect(result.diagnostics).toEqual([{ message, level: 'error' }])
    expect(requested.filter((argv) => !argv.includes('-c'))).toEqual([])
    expect(mechanism.spawnAttempts).toBe(1)

    mechanism.spawnError = null
    await expect(service.compile(units(3))).resolves.toMatchObject({ ok: true })
    expect(mechanism.spawnAttempts).toBe(2)
    expect(mechanism.alive).toBe(0)
  })

  it('runs two overlapping builds on one worker and ends it only after the last one finished', async () => {
    const { mechanism, service } = setup()

    const first = service.compile(units(6))
    const second = service.compile({ ...units(6), cFlags: ['-O2'] })
    const winner = await Promise.race([first, second])

    expect(winner.ok).toBe(true)
    expect(mechanism.alive).toBe(1)
    expect(mechanism.workers[0]?.terminateCalls).toBe(0)

    const results = await Promise.all([first, second])
    expect(results.map((r) => r.ok)).toEqual([true, true])
    expect(mechanism.started).toBe(1)
    expect(mechanism.maxAlive).toBe(1)
    expect(mechanism.alive).toBe(0)
  })

  it('keeps a running build on its worker when a malformed request ends meanwhile', async () => {
    const { mechanism, service } = setup()

    const build = service.compile(units(4))
    const refused = await service.compileRequest({ files: 'nope', units: [] })

    expect(refused.ok).toBe(false)
    await expect(build).resolves.toMatchObject({ ok: true })
    expect(mechanism.started).toBe(1)
    expect(mechanism.alive).toBe(0)
  })

  it('recompiles only the changed unit after the worker ended, taking the others from the cache', async () => {
    const { mechanism, service } = setup()
    const request = units(3)
    await service.compile(request)
    expect(mechanism.alive).toBe(0)
    const before = compileJobs(mechanism).length

    const again = await service.compile({ ...request, files: { ...request.files, 'u1.c': 'int u1 = 1;' } })

    expect(again.ok).toBe(true)
    expect(again.stats.cached).toBe(2)
    expect(compileJobs(mechanism).slice(before)).toEqual(['u1.c'])
    expect(mechanism.alive).toBe(0)
  })
})
