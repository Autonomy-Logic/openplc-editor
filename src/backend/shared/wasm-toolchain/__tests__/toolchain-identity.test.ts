import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from '@jest/globals'

import { digestParts, sha256Hex } from '../content-digest'
import { WASM_TOOLCHAIN_IDENTITY, WASM_TOOLCHAIN_PACKAGE, WASM_TOOLCHAIN_VERSION } from '../toolchain-identity'

describe('toolchain identity', () => {
  it('is the exact toolchain version package.json pins', () => {
    const manifest: unknown = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
    const pinned = ['dependencies', 'devDependencies'].map((section): unknown => {
      const deps: unknown = typeof manifest === 'object' && manifest !== null ? Reflect.get(manifest, section) : null
      return typeof deps === 'object' && deps !== null ? Reflect.get(deps, WASM_TOOLCHAIN_PACKAGE) : undefined
    })
    expect(pinned.filter((v) => v !== undefined)).toEqual([WASM_TOOLCHAIN_VERSION])
    expect(WASM_TOOLCHAIN_IDENTITY).toBe(`@yowasp/clang@${WASM_TOOLCHAIN_VERSION}`)
  })
})

describe('content digests', () => {
  it('is the SHA-256 of a value, text as UTF-8', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await sha256Hex(new Uint8Array([0x61, 0x62, 0x63]))).toBe(await sha256Hex('abc'))
  })

  it('tells part lists apart however their text splits, and text from bytes', async () => {
    const digests = await Promise.all([
      digestParts(['ab', 'c']),
      digestParts(['a', 'bc']),
      digestParts(['abc']),
      digestParts([new TextEncoder().encode('abc')]),
    ])
    expect(new Set(digests).size).toBe(4)
    expect(await digestParts(['ab', 'c'])).toBe(digests[0])
  })
})
