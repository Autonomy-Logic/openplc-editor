import { describe, expect, it } from '@jest/globals'

import type { WasmShippedObjectSource } from '@root/middleware/shared/ports/wasm-toolchain-mechanisms'

import { type CachedWasmObject, compileToWasm, type WasmCompileRequest } from '../compile-to-wasm'
import { sha256Hex } from '../content-digest'
import {
  encodeShippedObjects,
  isShippedObjectName,
  parseShippedObjectsIndex,
  readShippedObjects,
  SHIPPED_OBJECTS_INDEX,
} from '../shipped-objects'
import { createWasmCompileService } from '../wasm-compile-service'
import { FakeRunner } from './fixtures/fake-runner'
import { RecordingCache } from './fixtures/recording-cache'

const entry = async (bytes: number[]): Promise<CachedWasmObject> => ({
  object: new Uint8Array(bytes),
  digest: await sha256Hex(new Uint8Array(bytes)),
  dependencies: [['a.c', 'x']],
  includeNames: ['a.c'],
  shadowDigest: 's',
})

const sourceOf = (files: Record<string, Uint8Array>): WasmShippedObjectSource & { asked: string[] } => {
  const asked: string[] = []
  return {
    asked,
    read: (name) => {
      asked.push(name)
      return Promise.resolve(files[name] ?? null)
    },
  }
}

describe('shipped objects', () => {
  it('names only the index and records named by a digest', () => {
    expect(isShippedObjectName(SHIPPED_OBJECTS_INDEX)).toBe(true)
    expect(isShippedObjectName(`${'a'.repeat(64)}.obj`)).toBe(true)
    for (const bad of ['../index.json', `${'a'.repeat(63)}.obj`, `x/${'a'.repeat(64)}.obj`, 'project.json', ''])
      expect(isShippedObjectName(bad)).toBe(false)
  })

  it('round-trips a set for its toolchain, and gives nothing to another toolchain', async () => {
    const objects = [
      { key: 'core', entry: await entry([1, 2]) },
      { key: 'lib', entry: await entry([3]) },
    ]
    const files = await encodeShippedObjects('clang 1', objects)
    expect(Object.keys(files)).toHaveLength(3)
    expect(await readShippedObjects(sourceOf(files), 'clang 1')).toEqual(
      expect.arrayContaining(objects.map((o) => expect.objectContaining({ key: o.key }))),
    )
    expect(await readShippedObjects(sourceOf(files), 'clang 2')).toEqual([])
  })

  it('leaves out a record whose bytes differ from the index, and asks for no file the index does not name', async () => {
    const good = { key: 'core', entry: await entry([1, 2]) }
    const files = await encodeShippedObjects('clang 1', [good, { key: 'lib', entry: await entry([3]) }])
    const tampered = `${(await entry([3])).digest}.obj`
    files[tampered] = files[tampered].slice()
    files[tampered][files[tampered].length - 1] ^= 1
    const source = sourceOf(files)
    const read = await readShippedObjects(source, 'clang 1')
    expect(read.map((o) => o.key)).toEqual(['core'])
    expect(source.asked.every((name) => isShippedObjectName(name))).toBe(true)
  })

  it('refuses an index that names a path instead of a record', () => {
    const index = {
      format: 1,
      toolchain: 'clang 1',
      records: [{ name: '../../project/evil.obj', sha256: 'a'.repeat(64) }],
    }
    expect(parseShippedObjectsIndex(JSON.stringify(index))).toBeNull()
    expect(parseShippedObjectsIndex('not json')).toBeNull()
  })

  it('serves a build from the shipped objects while their files are unchanged, and recompiles otherwise', async () => {
    const request = (text: string): WasmCompileRequest => ({
      files: { 'core.c': text },
      units: [{ source: 'core.c', language: 'c' }],
    })
    const cache = new RecordingCache()
    const built = await compileToWasm(request('int a;'), { runner: new FakeRunner(), cache })
    expect(built.ok).toBe(true)
    const [key, [unit]] = [...cache.byKey.entries()].find(([, kept]) => kept[0].dependencies.length > 0) ?? ['', []]
    const files = await encodeShippedObjects('clang 1', [{ key, entry: unit }])

    const runner = new FakeRunner()
    const service = createWasmCompileService(runner, { shipped: sourceOf(files), identity: 'clang 1' })
    expect((await service.compile(request('int a;'))).stats.cached).toBe(1)
    expect(runner.jobs.filter((j) => j.argv.includes('-c'))).toEqual([])
    expect((await service.compile(request('int b;'))).stats.cached).toBe(0)
  })
})
