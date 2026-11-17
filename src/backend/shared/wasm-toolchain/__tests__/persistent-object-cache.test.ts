import { describe, expect, it } from '@jest/globals'

import type { WasmObjectStore } from '@root/middleware/shared/ports/wasm-toolchain-mechanisms'

import type { CachedWasmObject, WasmCompileRequest } from '../compile-to-wasm'
import { decodeObjectRecord, encodeObjectRecord, PersistentWasmObjectCache } from '../persistent-object-cache'
import { BoundedWasmObjectCache } from '../wasm-object-cache'
import { createWasmCompileService } from '../wasm-compile-service'
import { FakeRunner } from './fixtures/fake-runner'

const entry = (bytes: number[], name = 'a.c'): CachedWasmObject => ({
  object: new Uint8Array(bytes),
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
  it('round-trips an entry for the toolchain that wrote it, and nothing else', () => {
    const record = encodeObjectRecord('clang-a', entry([1, 2, 3]))
    expect(decodeObjectRecord('clang-a', record)).toEqual(entry([1, 2, 3]))
    expect(decodeObjectRecord('clang-b', record)).toBeNull()
  })

  it('drops damaged and foreign records', () => {
    const record = encodeObjectRecord('clang-a', entry([1, 2, 3]))
    const flipped = record.slice()
    flipped[flipped.length - 1] ^= 0xff
    const json = new TextEncoder().encode('{"version":2}')
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
      expect(decodeObjectRecord('clang-a', bad)).toBeNull()
  })
})

describe('PersistentWasmObjectCache', () => {
  it('fills the session cache from the store and removes records it cannot use', async () => {
    const store = new MemoryStore()
    store.records.set('keep', encodeObjectRecord('clang-a', entry([1])))
    store.records.set('old', encodeObjectRecord('clang-old', entry([2])))
    store.records.set('junk', new Uint8Array([9]))
    const cache = new PersistentWasmObjectCache(new BoundedWasmObjectCache(1024), store, 1024)
    await cache.load('clang-a')
    expect(cache.get('keep')).toEqual(entry([1]))
    expect([...store.records.keys()]).toEqual(['keep'])
  })

  it('writes new objects through once loaded, and keeps the store within its bound, oldest first', async () => {
    const store = new MemoryStore()
    const record = encodeObjectRecord('clang-a', entry([1, 2, 3, 4]))
    const cache = new PersistentWasmObjectCache(new BoundedWasmObjectCache(1 << 20), store, record.length * 2)
    cache.set('before', entry([0]))
    await cache.load('clang-a')
    cache.set('one', entry([1, 2, 3, 4]))
    cache.set('two', entry([1, 2, 3, 4], 'b.c'))
    await settle()
    expect([...store.records.keys()].sort()).toEqual(['one', 'two'])
    cache.set('three', entry([1, 2, 3, 4], 'c.c'))
    await settle()
    expect([...store.records.keys()].sort()).toEqual(['three', 'two'])
    cache.set('huge', entry(new Array(record.length * 3).fill(7)))
    await settle()
    expect(store.records.has('huge')).toBe(false)
    expect(cache.get('huge')).toBeDefined()
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
    expect(cache.get('k')).toEqual(entry([1]))
  })
})

describe('compile service with a store', () => {
  const request = (): WasmCompileRequest => ({
    files: { 'a.c': 'int a(void) { return 1; }' },
    units: [{ source: 'a.c', language: 'c' }],
  })
  const versioned = (version: string) =>
    new FakeRunner(2, (argv) =>
      argv.includes('--version') ? { exitCode: 0, produce: false } : { exitCode: 0 },
    ).withStdout(version)

  it('reuses the objects an earlier session compiled with the same toolchain', async () => {
    const store = new MemoryStore()
    const first = createWasmCompileService(versioned('clang 1'), store)
    await first.prepare()
    expect((await first.compile(request())).stats.cached).toBe(0)
    await settle()
    expect(store.records.size).toBe(1)

    const restarted = createWasmCompileService(versioned('clang 1'), store)
    await restarted.prepare()
    expect((await restarted.compile(request())).stats.cached).toBe(1)

    const upgraded = createWasmCompileService(versioned('clang 2'), store)
    await upgraded.prepare()
    expect((await upgraded.compile(request())).stats.cached).toBe(0)
  })

  it('compiles from the session cache alone when the store cannot be read', async () => {
    const store = new MemoryStore()
    store.readAll = () => Promise.reject(new Error('unreadable'))
    const warnings: string[] = []
    const service = createWasmCompileService(versioned('clang 1'), store, (message) => warnings.push(message))
    await service.prepare()
    expect((await service.compile(request())).ok).toBe(true)
    expect(warnings).toEqual(['Compiled objects of earlier sessions could not be read: unreadable'])
  })
})
