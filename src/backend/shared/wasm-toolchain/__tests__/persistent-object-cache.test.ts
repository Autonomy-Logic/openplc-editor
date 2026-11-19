import { describe, expect, it } from '@jest/globals'

import type { WasmObjectStore } from '@root/middleware/shared/ports/wasm-toolchain-mechanisms'

import type { CachedWasmObject, WasmCompileRequest } from '../compile-to-wasm'
import { decodeObjectRecord, encodeObjectRecord, PersistentWasmObjectCache } from '../persistent-object-cache'
import { BoundedWasmObjectCache } from '../wasm-object-cache'
import { createWasmCompileService } from '../wasm-compile-service'
import { FakeRunner } from './fixtures/fake-runner'

const digestOf = (bytes: number[], name: string): string =>
  `${name}:${bytes.join(',')}`
    .split('')
    .map((c) => c.charCodeAt(0).toString(16))
    .join('')
    .padEnd(64, '0')
    .slice(0, 64)

const entry = (bytes: number[], name = 'a.c'): CachedWasmObject => ({
  object: new Uint8Array(bytes),
  digest: digestOf(bytes, name),
  dependencies: [[name, 'digest']],
  includeNames: [name],
  shadowDigest: 'shadow',
})

/** A store in memory, as the platforms keep one on disk or in IndexedDB. */
class MemoryStore implements WasmObjectStore {
  records = new Map<string, Uint8Array>()
  failWrites = false
  readAll() {
    return Promise.resolve([...this.records.entries()])
  }
  write(key: string, record: Uint8Array) {
    if (this.failWrites) return Promise.reject(new Error('disk full'))
    this.records.set(key, record)
    return Promise.resolve()
  }
  remove(key: string) {
    this.records.delete(key)
    return Promise.resolve()
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('object records', () => {
  it('round-trips an entry and its key for the toolchain that wrote it, and nothing else', async () => {
    const record = await encodeObjectRecord('clang-a', 'unit', entry([1, 2, 3]))
    expect(await decodeObjectRecord('clang-a', record)).toEqual({ key: 'unit', entry: entry([1, 2, 3]) })
    expect(await decodeObjectRecord('clang-b', record)).toBeNull()
  })

  it('drops damaged and foreign records', async () => {
    const record = await encodeObjectRecord('clang-a', 'unit', entry([1, 2, 3]))
    const flipped = record.slice()
    flipped[flipped.length - 1] ^= 0xff
    const json = new TextEncoder().encode('{"version":1}')
    const other = new Uint8Array(4 + json.length)
    new DataView(other.buffer).setUint32(0, json.length, true)
    other.set(json, 4)
    for (const bad of [
      flipped,
      record.subarray(0, 10),
      new Uint8Array([1, 0]),
      new Uint8Array([3, 0, 0, 0, 1, 2, 3]),
      other,
    ])
      expect(await decodeObjectRecord('clang-a', bad)).toBeNull()
  })
})

describe('PersistentWasmObjectCache', () => {
  it('fills the session cache from the store and removes records it cannot use', async () => {
    const store = new MemoryStore()
    const kept = entry([1])
    store.records.set(kept.digest, await encodeObjectRecord('clang-a', 'keep', kept))
    store.records.set('old', await encodeObjectRecord('clang-old', 'keep', entry([2])))
    store.records.set('renamed', await encodeObjectRecord('clang-a', 'keep', entry([3])))
    store.records.set('junk', new Uint8Array([9]))
    const cache = new PersistentWasmObjectCache(new BoundedWasmObjectCache(1024), store, 1024)
    await cache.load('clang-a')
    expect(cache.variants('keep')).toEqual([kept])
    expect([...store.records.keys()]).toEqual([kept.digest])
  })

  it('stores each content of a key as its own record, so builds of other contents do not evict it', async () => {
    const store = new MemoryStore()
    const cache = new PersistentWasmObjectCache(new BoundedWasmObjectCache(1 << 20), store, 1 << 20)
    await cache.load('clang-a')
    cache.set('library', entry([1], 'with-plc-constants.hpp'))
    cache.set('library', entry([2], 'without.hpp'))
    await settle()
    expect(store.records.size).toBe(2)
    const restarted = new PersistentWasmObjectCache(new BoundedWasmObjectCache(1 << 20), store, 1 << 20)
    await restarted.load('clang-a')
    expect(restarted.variants('library')).toHaveLength(2)
  })

  it('writes new objects through once loaded, and keeps the store within its bound, oldest first', async () => {
    const store = new MemoryStore()
    const record = await encodeObjectRecord('clang-a', 'one', entry([1, 2, 3, 4]))
    const cache = new PersistentWasmObjectCache(new BoundedWasmObjectCache(1 << 20), store, record.length * 2 + 8)
    cache.set('before', entry([0]))
    await cache.load('clang-a')
    const [one, two, three] = [entry([1, 2, 3, 4]), entry([1, 2, 3, 4], 'b.c'), entry([1, 2, 3, 4], 'c.c')]
    cache.set('one', one)
    await settle()
    cache.set('two', two)
    await settle()
    expect([...store.records.keys()].sort()).toEqual([one.digest, two.digest].sort())
    cache.set('three', three)
    await settle()
    expect([...store.records.keys()].sort()).toEqual([three.digest, two.digest].sort())
    const huge = entry(new Array(record.length * 3).fill(7))
    cache.set('huge', huge)
    await settle()
    expect(store.records.has(huge.digest)).toBe(false)
    expect(cache.variants('huge')).toHaveLength(1)
  })

  it('reports a store that cannot write, and keeps the object for the session', async () => {
    const store = new MemoryStore()
    const errors: string[] = []
    const cache = new PersistentWasmObjectCache(new BoundedWasmObjectCache(1024), store, 1024, (m) => errors.push(m))
    await cache.load('clang-a')
    store.failWrites = true
    cache.set('k', entry([1]))
    await settle()
    expect(errors).toEqual(['disk full'])
    expect(cache.variants('k')).toEqual([entry([1])])
  })
})

describe('compile service with a store', () => {
  const request = (): WasmCompileRequest => ({
    files: { 'a.c': 'int a(void) { return 1; }' },
    units: [{ source: 'a.c', language: 'c' }],
  })
  const edited = (): WasmCompileRequest => ({ ...request(), files: { 'a.c': 'int a(void) { return 2; }' } })

  it('reuses the objects and the module an earlier session built with the same toolchain', async () => {
    const store = new MemoryStore()
    const first = createWasmCompileService(new FakeRunner(), { store, identity: 'clang 1' })
    await first.prepare()
    expect((await first.compile(request())).stats.cached).toBe(0)
    await settle()
    expect(store.records.size).toBe(2)

    const runner = new FakeRunner()
    const restarted = createWasmCompileService(runner, { store, identity: 'clang 1' })
    await restarted.prepare()
    expect((await restarted.compile(request())).stats.cached).toBe(1)
    expect(runner.jobs).toEqual([])
    expect((await restarted.compile(edited())).stats.cached).toBe(0)
    expect((await restarted.compile(request())).stats.cached).toBe(1)

    const upgraded = createWasmCompileService(new FakeRunner(), { store, identity: 'clang 2' })
    await upgraded.prepare()
    expect((await upgraded.compile(request())).stats.cached).toBe(0)
  })

  it('reads the store when the toolchain is prepared, starting no clang job', async () => {
    const store = new MemoryStore()
    let reads = 0
    const readAll = store.readAll.bind(store)
    store.readAll = () => {
      reads++
      return readAll()
    }
    const runner = new FakeRunner()
    const service = createWasmCompileService(runner, { store, identity: 'clang 1' })
    await service.prepare()
    await settle()
    expect(reads).toBe(1)
    expect(runner.jobs).toEqual([])
  })

  it('compiles from the session cache alone when the store cannot be read', async () => {
    const store = new MemoryStore()
    store.readAll = () => Promise.reject(new Error('unreadable'))
    const warnings: string[] = []
    const service = createWasmCompileService(new FakeRunner(), { store, log: (message) => warnings.push(message) })
    await service.prepare()
    expect((await service.compile(request())).ok).toBe(true)
    expect(warnings).toEqual(['Compiled objects of earlier sessions could not be read: unreadable'])
  })
})
