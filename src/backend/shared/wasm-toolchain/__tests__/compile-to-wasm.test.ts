import { describe, expect, it } from '@jest/globals'

import { type CachedWasmObject, compileToWasm, type WasmCompileRequest } from '../compile-to-wasm'
import { FakeRunner } from './fixtures/fake-runner'

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
    const cache = new Map<string, CachedWasmObject>()
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
    const cache = new Map<string, CachedWasmObject>()
    await compileToWasm(request(), { runner: runnerWithIncludes(), cache })
    const deps = [...cache.values()].map((e) => e.dependencies.map(([path]) => path).sort())
    expect(deps).toContainEqual(['core/core.c', 'core/core.h'])
    expect(deps).toContainEqual(['app/main.cpp'])
  })

  it('recompiles only the units that include a changed header', async () => {
    const cache = new Map<string, CachedWasmObject>()
    await compileToWasm(request(), { runner: runnerWithIncludes(), cache })
    const runner = runnerWithIncludes()
    const changed = request()
    changed.files['core/core.h'] = 'int core(void); int extra(void);'
    const result = await compileToWasm(changed, { runner, cache })
    expect(result.stats.cached).toBe(1)
    expect(compiledSources(runner)).toEqual(['core/core.c'])
  })

  it('recompiles a unit that includes another unit when that unit changes', async () => {
    const cache = new Map<string, CachedWasmObject>()
    const unity = { 'app/main.cpp': ['core/core.c'] }
    await compileToWasm(request(), { runner: runnerWithIncludes(unity), cache })
    const runner = runnerWithIncludes(unity)
    const changed = request()
    changed.files['core/core.c'] = 'int core(void) { return 9; }'
    const result = await compileToWasm(changed, { runner, cache })
    expect(result.stats.cached).toBe(0)
    expect(compiledSources(runner).sort()).toEqual(['app/main.cpp', 'core/core.c'])
  })

  it('recompiles every unit when a file is added or removed, since an include may now resolve elsewhere', async () => {
    const cache = new Map<string, CachedWasmObject>()
    await compileToWasm(request(), { runner: runnerWithIncludes(), cache })
    const added = request()
    added.files['app/core.h'] = 'int core(void);'
    expect((await compileToWasm(added, { runner: runnerWithIncludes(), cache })).stats.cached).toBe(0)
  })

  it('recompiles a unit when its flags change', async () => {
    const cache = new Map<string, CachedWasmObject>()
    await compileToWasm(request(), { runner: new FakeRunner(), cache })
    const result = await compileToWasm(request({ cxxFlags: ['-std=gnu++20'] }), { runner: new FakeRunner(), cache })
    expect(result.stats.cached).toBe(1)
  })

  it('does not cache an object whose dependency list names a file it was not given', async () => {
    const cache = new Map<string, CachedWasmObject>()
    await compileToWasm(request(), { runner: runnerWithIncludes({ 'app/main.cpp': ['app/config\\#1.h'] }), cache })
    expect([...cache.values()].map((e) => e.dependencies.map(([p]) => p).sort())).toEqual([
      ['core/core.c', 'core/core.h'],
    ])
  })

  it.each(['missing', 'garbage'] as const)('does not cache an object whose dependency file is %s', async (kind) => {
    const cache = new Map<string, CachedWasmObject>()
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
    expect(log).toEqual([['core/core.c:1:1: warning: unused', 'warning']])
  })

  it('does not cache the object of a failed unit', async () => {
    const cache = new Map<string, CachedWasmObject>()
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
