import { describe, expect, it } from '@jest/globals'

import { type CachedWasmObject, compileToWasm } from '../compile-to-wasm'
import { parseWasmCompileRequest } from '../parse-wasm-compile-request'
import { createWasmCompileService } from '../wasm-compile-service'
import { BoundedWasmObjectCache } from '../wasm-object-cache'
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
