import { describe, expect, it } from '@jest/globals'

import type { WasmLibraryObjectStore } from '@root/middleware/shared/ports/wasm-toolchain-mechanisms'
import type { WasmCompileUnit } from '@root/middleware/shared/ports/wasm-toolchain-types'

import type { CachedWasmObject } from '../compile-to-wasm'
import {
  decodeLibraryObject,
  encodeLibraryObject,
  keepLibraryObjects,
  libraryObjectKey,
  offerLibraryObjects,
} from '../library-objects'
import { parseWasmCompileRequest } from '../parse-wasm-compile-request'
import type { StoredWasmObject } from '../persistent-object-cache'
import { createWasmCompileService } from '../wasm-compile-service'
import { FakeRunner } from './fixtures/fake-runner'

const TOOLCHAIN = 'clang@test'

const entry = (digest: string): CachedWasmObject => ({
  object: new Uint8Array([1, 2, 3]),
  digest: digest.padEnd(64, '0'),
  dependencies: [['lib/a.cpp', 'x']],
  includeNames: ['a.cpp'],
  shadowDigest: 's',
})

/** An in-memory store, with every read and write recorded. */
class MemoryLibraryObjects implements WasmLibraryObjectStore {
  readonly files = new Map<string, Uint8Array>()
  readonly writes: string[] = []
  failReads = false
  failWrites = false
  read(library: string, kind: string): Promise<Uint8Array | null> {
    if (this.failReads) return Promise.reject(new Error('read failed'))
    return Promise.resolve(this.files.get(`${library}:${kind}`) ?? null)
  }
  write(library: string, kind: string, bytes: Uint8Array): Promise<void> {
    if (this.failWrites) return Promise.reject(new Error('disk full'))
    this.writes.push(`${library}:${kind}`)
    this.files.set(`${library}:${kind}`, bytes)
    return Promise.resolve()
  }
}

const KEY_INPUT = {
  kind: 'simulator' as const,
  archive: '{"manifest":{"name":"lib"}}',
  dependencies: ['{"manifest":{"name":"dep"}}'],
  flags: ['-O1'],
  providedHeaders: ['hmi_core.h@1'],
}

describe('library object keys', () => {
  it('change with the archive, its dependencies, the kind, the flags and the provided headers', async () => {
    const base = await libraryObjectKey(KEY_INPUT)
    expect(await libraryObjectKey({ ...KEY_INPUT })).toBe(base)
    const changed = await Promise.all([
      libraryObjectKey({ ...KEY_INPUT, archive: '{"manifest":{"name":"lib2"}}' }),
      libraryObjectKey({ ...KEY_INPUT, dependencies: [] }),
      libraryObjectKey({ ...KEY_INPUT, kind: 'hmi' }),
      libraryObjectKey({ ...KEY_INPUT, flags: ['-O2'] }),
      libraryObjectKey({ ...KEY_INPUT, providedHeaders: ['hmi_core.h@2'] }),
    ])
    for (const key of changed) expect(key).not.toBe(base)
    expect(new Set(changed).size).toBe(changed.length)
  })
})

describe('library object files', () => {
  it('give back the object only for the same key and toolchain', async () => {
    const bytes = await encodeLibraryObject(TOOLCHAIN, 'key-1', 'unit-key', entry('a'))
    expect(await decodeLibraryObject(TOOLCHAIN, 'key-1', bytes)).toEqual({ key: 'unit-key', entry: entry('a') })
    expect(await decodeLibraryObject(TOOLCHAIN, 'key-2', bytes)).toBeNull()
    expect(await decodeLibraryObject('clang@other', 'key-1', bytes)).toBeNull()
  })

  it('treat a damaged or foreign file as none', async () => {
    const bytes = await encodeLibraryObject(TOOLCHAIN, 'key-1', 'unit-key', entry('a'))
    const damaged = bytes.slice()
    damaged[damaged.length - 1] ^= 0xff
    expect(await decodeLibraryObject(TOOLCHAIN, 'key-1', damaged)).toBeNull()
    expect(await decodeLibraryObject(TOOLCHAIN, 'key-1', new Uint8Array([1, 2]))).toBeNull()
    expect(await decodeLibraryObject(TOOLCHAIN, 'key-1', new TextEncoder().encode('{"magic":1}'))).toBeNull()
  })
})

describe('offering and keeping library objects', () => {
  const unit: WasmCompileUnit = {
    source: 'lib/a.cpp',
    language: 'c++',
    library: { name: 'lib', kind: 'simulator', key: 'key-1' },
  }
  const plain: WasmCompileUnit = { source: 'main.cpp', language: 'c++' }

  it('offers the object whose key matches and does not write it back', async () => {
    const store = new MemoryLibraryObjects()
    store.files.set('lib:simulator', await encodeLibraryObject(TOOLCHAIN, 'key-1', 'unit-key', entry('a')))
    const offered: StoredWasmObject[] = []
    const result = await offerLibraryObjects([unit, plain], store, TOOLCHAIN, (o) => offered.push(o))
    expect(offered).toEqual([{ key: 'unit-key', entry: entry('a') }])
    await keepLibraryObjects(result, new Map([[unit.source, offered[0]]]), store, TOOLCHAIN, () => undefined)
    expect(store.writes).toEqual([])
  })

  it('offers nothing for another key, then replaces the file with the object the build used', async () => {
    const store = new MemoryLibraryObjects()
    store.files.set('lib:simulator', await encodeLibraryObject(TOOLCHAIN, 'old-key', 'unit-key', entry('a')))
    const offered: StoredWasmObject[] = []
    const result = await offerLibraryObjects([unit], store, TOOLCHAIN, (o) => offered.push(o))
    expect(offered).toEqual([])
    const used = { key: 'unit-key', entry: entry('b') }
    await keepLibraryObjects(result, new Map([[unit.source, used]]), store, TOOLCHAIN, () => undefined)
    expect(store.writes).toEqual(['lib:simulator'])
    const written = store.files.get('lib:simulator') ?? new Uint8Array()
    expect(await decodeLibraryObject(TOOLCHAIN, 'key-1', written)).toEqual(used)
  })

  it('compiles on when the store fails, and only warns when it cannot write', async () => {
    const store = new MemoryLibraryObjects()
    store.failReads = true
    store.failWrites = true
    const result = await offerLibraryObjects([unit], store, TOOLCHAIN, () => undefined)
    const warnings: string[] = []
    await keepLibraryObjects(result, new Map([[unit.source, { key: 'k', entry: entry('c') }]]), store, TOOLCHAIN, (m) =>
      warnings.push(m),
    )
    expect(warnings).toEqual([expect.stringContaining('"lib" could not be kept: disk full')])
  })
})

describe('the compile service with library objects', () => {
  const request = {
    files: { 'lib/a.cpp': 'int a;', 'main.cpp': 'int main;' },
    units: [
      { source: 'lib/a.cpp', language: 'c++' as const, library: { name: 'lib', kind: 'hmi' as const, key: 'k1' } },
      { source: 'main.cpp', language: 'c++' as const },
    ],
  }
  const compiledSources = (runner: FakeRunner): string[] =>
    runner.jobs
      .filter((j) => j.argv.includes('-c'))
      .map((j) => j.argv[j.argv.indexOf('-c') + 1])
      .sort()

  it('keeps the object next to the library, and a new session takes it from there instead of compiling', async () => {
    const store = new MemoryLibraryObjects()
    const first = new FakeRunner()
    expect(
      (await createWasmCompileService(first, { libraryObjects: store, identity: TOOLCHAIN }).compile(request)).ok,
    ).toBe(true)
    expect(compiledSources(first)).toEqual(['lib/a.cpp', 'main.cpp'])
    expect(store.writes).toEqual(['lib:hmi'])

    const second = new FakeRunner()
    const edited = { ...request, files: { ...request.files, 'main.cpp': 'int main2;' } }
    expect(
      (await createWasmCompileService(second, { libraryObjects: store, identity: TOOLCHAIN }).compile(edited)).ok,
    ).toBe(true)
    expect(compiledSources(second)).toEqual(['main.cpp'])
    expect(store.writes).toEqual(['lib:hmi'])
  })

  it('compiles and replaces the object when the key changes, and never uses one whose sources changed', async () => {
    const store = new MemoryLibraryObjects()
    await createWasmCompileService(new FakeRunner(), { libraryObjects: store, identity: TOOLCHAIN }).compile(request)

    const rekeyed = new FakeRunner()
    const units = [{ ...request.units[0], library: { name: 'lib', kind: 'hmi' as const, key: 'k2' } }, request.units[1]]
    expect(
      (
        await createWasmCompileService(rekeyed, { libraryObjects: store, identity: TOOLCHAIN }).compile({
          ...request,
          units,
        })
      ).ok,
    ).toBe(true)
    expect(compiledSources(rekeyed)).toEqual(['lib/a.cpp', 'main.cpp'])
    expect(store.writes).toEqual(['lib:hmi', 'lib:hmi'])

    const changed = new FakeRunner()
    const files = { ...request.files, 'lib/a.cpp': 'int a2;' }
    expect(
      (
        await createWasmCompileService(changed, { libraryObjects: store, identity: TOOLCHAIN }).compile({
          ...request,
          units,
          files,
        })
      ).ok,
    ).toBe(true)
    expect(compiledSources(changed)).toEqual(['lib/a.cpp', 'main.cpp'])
  })
})

describe('library tags across a boundary', () => {
  const request = (library: unknown) => ({
    files: { 'a.cpp': 'int a;' },
    units: [{ source: 'a.cpp', language: 'c++', library }],
  })

  it('keeps a valid tag and refuses one of an unknown kind or shape', () => {
    const tag = { name: 'lib', kind: 'simulator', key: 'k' }
    const parsed = parseWasmCompileRequest(request(tag))
    expect(parsed.ok && parsed.request.units[0].library).toEqual(tag)
    expect(parseWasmCompileRequest(request({ ...tag, kind: 'other' }))).toEqual({
      ok: false,
      error: "Unit 'a.cpp' has an invalid 'library'.",
    })
    expect(parseWasmCompileRequest(request('lib')).ok).toBe(false)
    const plain = parseWasmCompileRequest(request(undefined))
    expect(plain.ok && plain.request.units[0]).toEqual({ source: 'a.cpp', language: 'c++' })
  })
})
