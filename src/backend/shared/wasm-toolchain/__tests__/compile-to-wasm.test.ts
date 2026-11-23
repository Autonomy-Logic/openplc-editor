import { describe, expect, it } from '@jest/globals'

import type { WasmClangRunner } from '@root/middleware/shared/ports/wasm-toolchain-mechanisms'

import { ClangWorkerPool } from '../clang-worker-pool'
import { compileToWasm, type WasmCompileRequest } from '../compile-to-wasm'
import { CountingClangMechanism } from './fixtures/counting-clang-mechanism'
import { FakeRunner } from './fixtures/fake-runner'
import { RecordingCache } from './fixtures/recording-cache'

const request = (overrides: Partial<WasmCompileRequest> = {}): WasmCompileRequest => ({
  files: {
    'core/core.c': 'int core(void) { return 1; }',
    'core/core.h': 'int core(void);',
    'app/main.cpp': 'extern "C" int core(void); int main_entry() { return core(); }',
  },
  units: [
    { source: 'core/core.c', language: 'c' },
    { source: 'app/main.cpp', language: 'c++', flags: ['-DAPP'] },
  ],
  cFlags: ['-std=c99'],
  cxxFlags: ['-std=gnu++17'],
  linkFlags: ['-mexec-model=reactor'],
  ...overrides,
})

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)
const LINK_PATH = '__objects/module.wasm'
/** Resolves after pending timers and I/O, such as a digest, have had their turn. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('compileToWasm', () => {
  it('compiles each unit with its language flags and links the objects into the module', async () => {
    const runner = new FakeRunner()
    const result = await compileToWasm(request(), { runner })

    expect(result.ok).toBe(true)
    const compiles = runner.jobs.slice(0, 2).map((j) => j.argv)
    expect(compiles).toContainEqual([
      'clang',
      '--target=wasm32-wasip1',
      '-std=c99',
      '-MD',
      '-MF',
      expect.stringMatching(/^__objects\/\d+\.d$/),
      '-c',
      'core/core.c',
      '-o',
      expect.stringMatching(/^__objects\/\d+\.o$/),
    ])
    expect(compiles).toContainEqual([
      'clang++',
      '--target=wasm32-wasip1',
      '-std=gnu++17',
      '-DAPP',
      '-MD',
      '-MF',
      expect.stringMatching(/^__objects\/\d+\.d$/),
      '-c',
      'app/main.cpp',
      '-o',
      expect.stringMatching(/^__objects\/\d+\.o$/),
    ])
    const link = runner.jobs[2]
    expect(link.argv).toEqual([
      'clang++',
      '--target=wasm32-wasip1',
      '__objects/0.o',
      '__objects/1.o',
      '-mexec-model=reactor',
      '-o',
      '__objects/module.wasm',
    ])
    expect(FakeRunner.text(link.tree, '__objects/0.o')).toContain('core/core.c')
    expect(FakeRunner.text(link.tree, '__objects/1.o')).toContain('app/main.cpp')
    if (result.ok) expect(decode(result.wasm)).toBe(link.argv.join(' '))
  })

  it('gives every unit the whole input tree, so headers resolve', async () => {
    const runner = new FakeRunner()
    await compileToWasm(request(), { runner })
    for (const job of runner.jobs.slice(0, 2)) expect(FakeRunner.text(job.tree, 'core/core.h')).toBe('int core(void);')
  })

  it('links into its own work folder whatever the module is called, so a nested name needs no folder', async () => {
    const runner = new FakeRunner()
    const result = await compileToWasm(request({ output: 'out/preview.wasm' }), { runner })
    expect(result.ok).toBe(true)
    expect(runner.jobs[2].argv.slice(-2)).toEqual(['-o', '__objects/module.wasm'])
  })

  const compiledSources = (runner: FakeRunner): string[] =>
    runner.jobs.filter((j) => j.argv.includes('-c')).map((j) => j.argv[j.argv.indexOf('-c') + 1])

  const includes = { 'core/core.c': ['./core/core.h'] }
  const runnerWithIncludes = (extra: Record<string, string[]> = {}) =>
    new FakeRunner(2, undefined, null, { ...includes, ...extra })

  it('reuses cached objects for unchanged units and recompiles only the edited one', async () => {
    const cache = new RecordingCache()
    await compileToWasm(request(), { runner: runnerWithIncludes(), cache })
    expect(cache.size).toBe(2)

    const second = runnerWithIncludes()
    const edited = request()
    edited.files['app/main.cpp'] = 'int main_entry() { return 2; }'
    const result = await compileToWasm(edited, { runner: second, cache })

    expect(result.stats).toMatchObject({ units: 2, cached: 1 })
    expect(compiledSources(second)).toEqual(['app/main.cpp'])
  })

  it('records the request files each object was built from, not the toolchain headers', async () => {
    const cache = new RecordingCache()
    await compileToWasm(request(), { runner: runnerWithIncludes(), cache })
    const deps = [...cache.values()].map((e) => e.dependencies.map(([path]) => path).sort())
    expect(deps).toContainEqual(['core/core.c', 'core/core.h'])
    expect(deps).toContainEqual(['app/main.cpp'])
  })

  it('recompiles only the units that include a changed header', async () => {
    const cache = new RecordingCache()
    await compileToWasm(request(), { runner: runnerWithIncludes(), cache })
    const runner = runnerWithIncludes()
    const changed = request()
    changed.files['core/core.h'] = 'int core(void); int extra(void);'
    const result = await compileToWasm(changed, { runner, cache })
    expect(result.stats.cached).toBe(1)
    expect(compiledSources(runner)).toEqual(['core/core.c'])
  })

  it('recompiles a unit that includes another unit when that unit changes', async () => {
    const cache = new RecordingCache()
    const unity = { 'app/main.cpp': ['core/core.c'] }
    await compileToWasm(request(), { runner: runnerWithIncludes(unity), cache })
    const runner = runnerWithIncludes(unity)
    const changed = request()
    changed.files['core/core.c'] = 'int core(void) { return 9; }'
    const result = await compileToWasm(changed, { runner, cache })
    expect(result.stats.cached).toBe(0)
    expect(compiledSources(runner).sort()).toEqual(['app/main.cpp', 'core/core.c'])
  })

  it('keeps every object when an added file could not change what any include finds', async () => {
    const cache = new RecordingCache()
    await compileToWasm(request(), { runner: runnerWithIncludes(), cache })
    const added = request()
    added.files['screens/new_screen.cpp'] = 'int screen(void) { return 0; }'
    const runner = runnerWithIncludes()
    expect((await compileToWasm(added, { runner, cache })).stats.cached).toBe(2)
    expect(compiledSources(runner)).toEqual([])
  })

  it('recompiles only the units an added file could hide an include of, as one named like that include', async () => {
    const cache = new RecordingCache()
    await compileToWasm(request(), { runner: runnerWithIncludes(), cache })
    const added = request()
    added.files['app/core.h'] = 'int core(void);'
    const runner = runnerWithIncludes()
    expect((await compileToWasm(added, { runner, cache })).stats.cached).toBe(1)
    expect(compiledSources(runner)).toEqual(['core/core.c'])
  })

  it('recompiles a unit when a file named like one of its toolchain headers appears, and reuses the old one when it goes', async () => {
    const cache = new RecordingCache()
    await compileToWasm(request(), { runner: runnerWithIncludes(), cache })
    const shadowing = request()
    shadowing.files['core/stdio.h'] = '/* hides <stdio.h> */'
    expect((await compileToWasm(shadowing, { runner: runnerWithIncludes(), cache })).stats.cached).toBe(0)
    expect((await compileToWasm(shadowing, { runner: runnerWithIncludes(), cache })).stats.cached).toBe(2)
    const relinked = request({ linkFlags: ['-mexec-model=command'] })
    expect((await compileToWasm(relinked, { runner: runnerWithIncludes(), cache })).stats.cached).toBe(2)
  })

  it('recompiles a unit when its flags change', async () => {
    const cache = new RecordingCache()
    await compileToWasm(request(), { runner: new FakeRunner(), cache })
    const result = await compileToWasm(request({ cxxFlags: ['-std=gnu++20'] }), { runner: new FakeRunner(), cache })
    expect(result.stats.cached).toBe(1)
  })

  it('keeps an object per content of a unit, so two builds of other headers do not evict each other', async () => {
    const cache = new RecordingCache()
    const unity = { 'app/main.cpp': ['core/core.h'] }
    const gallery = request()
    gallery.files['core/core.h'] = 'int core(void); /* gallery */'
    await compileToWasm(request(), { runner: runnerWithIncludes(unity), cache })
    await compileToWasm(gallery, { runner: runnerWithIncludes(unity), cache })
    const again = request()
    again.linkFlags = ['-mexec-model=reactor', '-Wl,--no-entry']
    const runner = runnerWithIncludes(unity)
    expect((await compileToWasm(again, { runner, cache })).stats.cached).toBe(2)
    expect(compiledSources(runner)).toEqual([])
  })

  it('returns the module of a request it already linked, running no job', async () => {
    const cache = new RecordingCache()
    const first = await compileToWasm(request(), { runner: new FakeRunner(), cache })
    const runner = new FakeRunner()
    const second = await compileToWasm(request(), { runner, cache })
    expect(runner.jobs).toEqual([])
    expect(second).toMatchObject({ ok: true, stats: { units: 2, cached: 2 } })
    if (first.ok && second.ok) expect(second.wasm).toEqual(first.wasm)
    expect(cache.modules()).toHaveLength(1)
  })

  it('links again when anything of the request changes, even a file no unit reads', async () => {
    const cache = new RecordingCache()
    await compileToWasm(request(), { runner: runnerWithIncludes(), cache })
    const changes: Array<(r: WasmCompileRequest) => void> = [
      (r) => (r.files['notes.txt'] = 'x'),
      (r) => (r.linkFlags = ['-mexec-model=command']),
      (r) => (r.output = 'other.wasm'),
      (r) => (r.units = [...r.units].reverse()),
    ]
    for (const change of changes) {
      const changed = request()
      change(changed)
      const runner = runnerWithIncludes()
      await compileToWasm(changed, { runner, cache })
      expect(runner.jobs.some((j) => j.argv.includes(LINK_PATH))).toBe(true)
    }
  })

  it('does not cache an object whose dependency list names a file it was not given', async () => {
    const cache = new RecordingCache()
    await compileToWasm(request(), { runner: runnerWithIncludes({ 'app/main.cpp': ['app/config\\#1.h'] }), cache })
    expect([...cache.values()].map((e) => e.dependencies.map(([p]) => p).sort())).toEqual([
      ['core/core.c', 'core/core.h'],
    ])
  })

  describe('with a precompiled prelude', () => {
    const prelude = (nested: string, pch = 'pch-v1'): WasmCompileRequest =>
      request({
        files: {
          ...request().files,
          'pre.h': '#include "b.hpp"',
          'pre.pch': pch,
          'rt/b.hpp': '#include "c.hpp"',
          'rt/c.hpp': nested,
        },
        units: [
          { source: 'core/core.c', language: 'c' },
          { source: 'app/main.cpp', language: 'c++', flags: ['-include-pch', 'pre.pch'] },
        ],
      })
    const throughPch = { ...includes, 'app/main.cpp': ['/pre.h', '/rt/b.hpp', '/rt/c.hpp'] }
    const pchRunner = () => new FakeRunner(2, undefined, null, throughPch)

    it('records the headers clang lists as absolute paths through the prelude, and the prelude itself', async () => {
      const cache = new RecordingCache()
      await compileToWasm(prelude('int c();'), { runner: pchRunner(), cache })
      const deps = [...cache.values()].map((e) => e.dependencies.map(([path]) => path).sort())
      expect(deps).toContainEqual(['app/main.cpp', 'pre.h', 'pre.pch', 'rt/b.hpp', 'rt/c.hpp'])
      expect(deps).toContainEqual(['core/core.c', 'core/core.h'])
    })

    it('does not reuse an object when a header nested inside the prelude changes', async () => {
      const cache = new RecordingCache()
      await compileToWasm(prelude('int c();'), { runner: pchRunner(), cache })
      const runner = pchRunner()
      const result = await compileToWasm(prelude('int c(); int d();'), { runner, cache })
      expect(result.stats.cached).toBe(1)
      expect(compiledSources(runner)).toEqual(['app/main.cpp'])
    })

    it('does not reuse an object when only the precompiled prelude changes', async () => {
      const cache = new RecordingCache()
      await compileToWasm(prelude('int c();'), { runner: pchRunner(), cache })
      const runner = pchRunner()
      const result = await compileToWasm(prelude('int c();', 'pch-v2'), { runner, cache })
      expect(result.stats.cached).toBe(1)
      expect(compiledSources(runner)).toEqual(['app/main.cpp'])
    })

    it('reuses the object while neither the prelude nor its headers change', async () => {
      const cache = new RecordingCache()
      await compileToWasm(prelude('int c();'), { runner: pchRunner(), cache })
      const again = prelude('int c();')
      again.linkFlags = ['-mexec-model=command']
      const runner = pchRunner()
      expect((await compileToWasm(again, { runner, cache })).stats.cached).toBe(2)
      expect(compiledSources(runner)).toEqual([])
    })
  })

  it('records an object built without a prelude from the same files and names as before', async () => {
    const cache = new RecordingCache()
    await compileToWasm(request(), { runner: runnerWithIncludes(), cache })
    const core = [...cache.values()].find((e) => e.dependencies.some(([p]) => p === 'core/core.c'))
    expect(core?.dependencies.map(([p]) => p)).toEqual(['core/core.c', 'core/core.h'])
    expect(core?.includeNames).toEqual(['core.c', 'core.h', 'stdio.h'])
  })

  it.each(['missing', 'garbage'] as const)('does not cache an object whose dependency file is %s', async (kind) => {
    const cache = new RecordingCache()
    const runner = new FakeRunner(2, (argv) =>
      argv.includes('core/core.c') ? { exitCode: 0, dependencyFile: kind } : { exitCode: 0 },
    )
    await compileToWasm(request(), { runner, cache })
    expect(cache.size).toBe(1)
  })

  it('never runs more jobs at once than the runner allows, largest unit first', async () => {
    const files: Record<string, string> = {}
    const units = Array.from({ length: 7 }, (_, i) => {
      files[`u${i}.c`] = 'x'.repeat(i + 1)
      return { source: `u${i}.c`, language: 'c' as const }
    })
    const runner = new FakeRunner(3)
    const result = await compileToWasm({ files, units }, { runner })
    expect(result.ok).toBe(true)
    expect(runner.maxActive).toBeLessThanOrEqual(3)
    expect(runner.jobs[0].argv).toContain('u6.c')
  })

  it('reports compile errors to the log and fails without linking', async () => {
    const runner = new FakeRunner(2, (argv) =>
      argv.includes('app/main.cpp')
        ? { exitCode: 1, stderr: "app/main.cpp:1:5: error: unknown type name 'foo'\n1 error generated.\n" }
        : { exitCode: 0 },
    )
    const log: Array<[string, string]> = []
    const result = await compileToWasm(request(), { runner, log: (m, l) => log.push([m, l]) })

    expect(result.ok).toBe(false)
    expect(runner.jobs.some((j) => j.argv.includes('module.wasm'))).toBe(false)
    expect(log).toContainEqual(["app/main.cpp:1:5: error: unknown type name 'foo'", 'error'])
    expect(log).toContainEqual(['1 error generated.', 'error'])
    if (!result.ok) expect(result.error).toContain('app/main.cpp: clang exited with code 1.')
  })

  it('reports warnings of successful units as warnings', async () => {
    const runner = new FakeRunner(2, (argv) =>
      argv.includes('core/core.c') ? { exitCode: 0, stderr: 'core/core.c:1:1: warning: unused\n' } : { exitCode: 0 },
    )
    const log: Array<[string, string]> = []
    const result = await compileToWasm(request(), { runner, log: (m, l) => log.push([m, l]) })
    expect(result.ok).toBe(true)
    expect(log.filter(([, level]) => level !== 'info')).toEqual([['core/core.c:1:1: warning: unused', 'warning']])
  })

  it('logs what it compiles, each file as it ends and the link, and keeps them out of the diagnostics', async () => {
    const log: Array<[string, string]> = []
    const result = await compileToWasm(request(), { runner: new FakeRunner(1), log: (m, l) => log.push([m, l]) })
    expect(result.ok).toBe(true)
    expect(log[0]).toEqual(['Compiling 2 of 2 files...', 'info'])
    expect(log.slice(1, 3).map(([m]) => m.replace(/^Compiled \S+ /, 'Compiled * '))).toEqual([
      'Compiled * (1/2)',
      'Compiled * (2/2)',
    ])
    expect(
      log
        .slice(1, 3)
        .map(([m]) => m.split(' ')[1])
        .sort(),
    ).toEqual(['app/main.cpp', 'core/core.c'])
    expect(log[3]).toEqual(['Linking module.wasm...', 'info'])
    expect(log).toHaveLength(4)
    expect(result.diagnostics).toEqual([])
  })

  it('counts the reused files and logs only the ones it compiles', async () => {
    const cache = new RecordingCache()
    await compileToWasm(request(), { runner: runnerWithIncludes(), cache })
    const edited = request()
    edited.files['app/main.cpp'] = 'int main_entry() { return 2; }'
    const log: string[] = []
    await compileToWasm(edited, { runner: runnerWithIncludes(), cache, log: (m) => log.push(m) })
    expect(log).toEqual([
      'Compiling 1 of 2 files (1 reused)...',
      'Compiled app/main.cpp (1/1)',
      'Linking module.wasm...',
    ])
  })

  it('logs nothing when the whole module comes from the cache', async () => {
    const cache = new RecordingCache()
    await compileToWasm(request(), { runner: new FakeRunner(), cache })
    const log: string[] = []
    const result = await compileToWasm(request(), { runner: new FakeRunner(), cache, log: (m) => log.push(m) })
    expect(result.ok).toBe(true)
    expect(log).toEqual([])
  })

  it('does not cache the object of a failed unit', async () => {
    const cache = new RecordingCache()
    const runner = new FakeRunner(2, (argv) => (argv.includes('core/core.c') ? { exitCode: 1 } : { exitCode: 0 }))
    await compileToWasm(request(), { runner, cache })
    expect(cache.size).toBe(1)
  })

  it('fails when clang reports success without writing the object', async () => {
    const runner = new FakeRunner(2, (argv) =>
      argv.includes('-c') ? { exitCode: 0, produce: false } : { exitCode: 0 },
    )
    const result = await compileToWasm(request(), { runner })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('clang reported success but produced no object.')
  })

  it('turns a runner that cannot run a job into a failure instead of a rejection', async () => {
    const runner = new FakeRunner(2, (argv) => (argv.includes('core/core.c') ? 'throw' : { exitCode: 0 }))
    const log: Array<[string, string]> = []
    const result = await compileToWasm(request(), { runner, log: (m, l) => log.push([m, l]) })
    expect(result.ok).toBe(false)
    expect(log).toContainEqual(['worker crashed', 'error'])
    if (!result.ok) expect(result.error).toContain('core/core.c: clang could not be run.')
  })

  it('reports a failed link', async () => {
    const runner = new FakeRunner(2, (argv) =>
      argv.includes('-c') ? { exitCode: 0 } : { exitCode: 1, stderr: 'wasm-ld: error: undefined symbol: core\n' },
    )
    const log: Array<[string, string]> = []
    const result = await compileToWasm(request(), { runner, log: (m, l) => log.push([m, l]) })
    expect(result.ok).toBe(false)
    expect(log).toContainEqual(['wasm-ld: error: undefined symbol: core', 'error'])
    if (!result.ok) expect(result.error).toBe('Link failed: clang exited with code 1.')
  })

  it('fails when the link reports success without writing the module', async () => {
    const runner = new FakeRunner(2, (argv) =>
      argv.includes('-c') ? { exitCode: 0 } : { exitCode: 0, produce: false },
    )
    const result = await compileToWasm(request(), { runner })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe("Link failed: clang reported success but produced no 'module.wasm'.")
  })

  it.each([
    [{ units: [] }, 'Nothing to compile: no translation units were given.'],
    [
      {
        units: [
          { source: 'core/core.c', language: 'c' as const },
          { source: 'core/core.c', language: 'c' as const },
        ],
      },
      "Translation unit 'core/core.c' is listed more than once.",
    ],
    [
      { units: [{ source: 'missing.c', language: 'c' as const }] },
      "Translation unit 'missing.c' is not among the input files.",
    ],
  ])('rejects an invalid request before running clang', async (overrides, message) => {
    const runner = new FakeRunner()
    const log: Array<[string, string]> = []
    const result = await compileToWasm(request(overrides), { runner, log: (m, l) => log.push([m, l]) })
    expect(result).toMatchObject({ ok: false, error: message })
    expect(log).toEqual([[message, 'error']])
    expect(runner.jobs).toHaveLength(0)
  })
})

describe('compileToWasm when the toolchain cannot load', () => {
  it('fails with the load message as an error diagnostic, and runs no link job', async () => {
    const mechanism = new CountingClangMechanism()
    mechanism.autoReady = false
    const pool = new ClangWorkerPool(mechanism)
    const jobs: string[][] = []
    const runner: WasmClangRunner = {
      concurrency: pool.concurrency,
      prepare: () => pool.prepare(),
      release: () => pool.release(),
      run: (job) => {
        jobs.push(job.argv)
        return pool.run(job)
      },
    }
    const log: Array<[string, string]> = []

    const compiling = compileToWasm(request(), { runner, log: (m, l) => log.push([m, l]) })
    for (let round = 0; round < 200 && mechanism.started === 0; round++) await tick()
    mechanism.workers[0]?.fail('llvm.core.wasm is not valid WebAssembly')
    const result = await compiling

    const message = 'The WebAssembly compiler could not be loaded: llvm.core.wasm is not valid WebAssembly'
    expect(result).toMatchObject({ ok: false, error: message })
    expect(result.diagnostics).toContainEqual({ message, level: 'error' })
    expect(log).toContainEqual([message, 'error'])
    expect(jobs.filter((argv) => !argv.includes('-c'))).toEqual([])
    expect(mechanism.workers.flatMap((w) => w.posted)).toEqual([])
  })

  it('keeps the per-file failure message for a job that fails after the worker loaded', async () => {
    const mechanism = new CountingClangMechanism()
    const pool = new ClangWorkerPool(mechanism)

    const compiling = compileToWasm(request(), { runner: pool })
    for (let round = 0; round < 200 && (mechanism.workers[0]?.posted.length ?? 0) === 0; round++) {
      await tick()
    }
    mechanism.workers[0]?.fail('exit code 3')
    for (let round = 0; round < 200 && (mechanism.workers[1]?.posted.length ?? 0) === 0; round++) {
      await tick()
    }
    mechanism.workers[1]?.fail('exit code 3')
    const result = await compiling

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.error).toMatch(/^Compilation failed in 2 of 2 file\(s\): /)
    await pool.release()
  })
})
