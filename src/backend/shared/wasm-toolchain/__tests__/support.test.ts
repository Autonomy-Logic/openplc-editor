import { describe, expect, it } from '@jest/globals'

import { ContentHash } from '../content-hash'
import { filesToTree, readTreeFile } from '../file-tree'
import { prepareWasmToolchain } from '../prepare-toolchain'
import { FakeRunner } from './fixtures/fake-runner'

describe('filesToTree / readTreeFile', () => {
  it('nests files by directory and reads them back', () => {
    const bytes = new Uint8Array([1, 2])
    const tree = filesToTree({ 'a/b/c.h': 'h', 'a/d.o': bytes, 'top.c': 't' })
    expect(tree).toEqual({ a: { b: { 'c.h': 'h' }, 'd.o': bytes }, 'top.c': 't' })
    expect(readTreeFile(tree, 'a/b/c.h')).toBe('h')
    expect(readTreeFile(tree, 'a/d.o')).toBe(bytes)
    expect(readTreeFile(tree, 'a/b')).toBeUndefined()
    expect(readTreeFile(tree, 'a/missing.h')).toBeUndefined()
    expect(readTreeFile(tree, 'top.c/x')).toBeUndefined()
  })

  it.each(['', '/abs.c', 'a//b.c', '../up.c', 'a/./b.c'])('rejects the path %j', (path) => {
    expect(() => filesToTree({ [path]: 'x' })).toThrow('Invalid toolchain file path')
  })

  it('rejects a path that goes through a file or onto a directory', () => {
    expect(() => filesToTree({ a: 'file', 'a/b.c': 'x' })).toThrow("goes through the file 'a'")
    expect(() => filesToTree({ 'a/b.c': 'x', a: 'file' })).toThrow("'a' is also a directory")
  })
})

describe('ContentHash', () => {
  const digest = (...values: Array<string | Uint8Array>): string => {
    const h = new ContentHash()
    for (const v of values) h.update(v)
    return h.digest()
  }

  it('is stable and 16 hex digits', () => {
    expect(digest('abc')).toBe(digest('abc'))
    expect(digest('abc')).toMatch(/^[0-9a-f]{16}$/)
  })

  it('tells apart content, boundaries and kinds', () => {
    expect(digest('abc')).not.toBe(digest('abd'))
    expect(digest('ab', 'c')).not.toBe(digest('a', 'bc'))
    expect(digest('a')).not.toBe(digest(new Uint8Array([97])))
    expect(digest('Ā')).not.toBe(digest('\u0001'))
  })
})

describe('prepareWasmToolchain', () => {
  it('reports readiness once the runner has loaded', async () => {
    const runner = new FakeRunner()
    const ready = await prepareWasmToolchain(runner)
    expect(ready.ok).toBe(true)
    expect(runner.prepared).toBe(1)
  })

  it('turns a load failure into the startup message', async () => {
    const ready = await prepareWasmToolchain(new FakeRunner(2, undefined, new Error('llvm.core.wasm not found')))
    expect(ready).toEqual({
      ok: false,
      message: 'The WebAssembly compiler could not be loaded: llvm.core.wasm not found',
    })
  })
})
