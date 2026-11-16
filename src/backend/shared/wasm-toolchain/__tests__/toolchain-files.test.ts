/**
 * Reads the installed `@yowasp/clang` package from the repository's node_modules.
 * @jest-environment node
 * @vitest-environment node
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from '@jest/globals'

import { requireFiles, WASM_TOOLCHAIN_PACKAGE_FILES } from '../toolchain-files'

const repo = join(__dirname, '..', '..', '..', '..', '..')
const installedGen = join(repo, 'node_modules', '@yowasp', 'clang', 'gen')

/** An `exists` check over a fixed set of present paths, recording what it was asked. */
const presentOnly = (present: string[]) => {
  const asked: string[] = []
  const exists = (path: string): Promise<boolean> => {
    asked.push(path)
    return Promise.resolve(present.includes(path))
  }
  return { asked, exists }
}

describe('WASM_TOOLCHAIN_PACKAGE_FILES', () => {
  it('lists the bundle, the resource archive and the four WebAssembly cores, relative to the package root', () => {
    expect([...WASM_TOOLCHAIN_PACKAGE_FILES].sort()).toEqual([
      'gen/bundle.js',
      'gen/llvm-resources.tar',
      'gen/llvm.core.wasm',
      'gen/llvm.core2.wasm',
      'gen/llvm.core3.wasm',
      'gen/llvm.core4.wasm',
    ])
  })

  it('matches bundle.js plus every .wasm and .tar file of the installed package', () => {
    const installed = readdirSync(installedGen)
      .filter((name) => name === 'bundle.js' || name.endsWith('.wasm') || name.endsWith('.tar'))
      .map((name) => `gen/${name}`)
      .sort()

    expect([...WASM_TOOLCHAIN_PACKAGE_FILES].sort()).toEqual(installed)
  })
})

describe('requireFiles', () => {
  it('resolves when every file is present', async () => {
    const { exists } = presentOnly(['/a', '/b'])

    await expect(requireFiles(['/a', '/b'], exists, 'toolchain')).resolves.toBeUndefined()
  })

  it('rejects naming the missing file and what it belongs to', async () => {
    const { exists } = presentOnly(['/runtime/sdk.js', '/runtime/numpy.whl'])

    await expect(
      requireFiles(['/runtime/sdk.js', '/runtime/python.webc', '/runtime/numpy.whl'], exists, 'Python runtime'),
    ).rejects.toThrow('Missing Python runtime file: /runtime/python.webc')
  })

  it('names the first missing file in the given order when several are missing', async () => {
    const { exists } = presentOnly(['/clang/gen/bundle.js'])

    const error = await requireFiles(
      ['/clang/gen/bundle.js', '/clang/gen/llvm.core3.wasm', '/clang/gen/llvm.core.wasm'],
      exists,
      'toolchain',
    ).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(Error)
    expect(error instanceof Error ? error.message : '').toBe('Missing toolchain file: /clang/gen/llvm.core3.wasm')
  })

  it('resolves for an empty list', async () => {
    const { asked, exists } = presentOnly([])

    await expect(requireFiles([], exists, 'toolchain')).resolves.toBeUndefined()
    expect(asked).toEqual([])
  })
})
