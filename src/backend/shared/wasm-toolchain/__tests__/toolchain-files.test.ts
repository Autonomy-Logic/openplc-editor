/**
 * Reads the installed `@yowasp/clang` package from the repository's node_modules.
 * @jest-environment node
 * @vitest-environment node
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from '@jest/globals'

import { checkWasmToolchainPackage, requireFiles, WASM_TOOLCHAIN_PACKAGE_FILES } from '../toolchain-files'
import { patchYowaspLoader } from '../yowasp-loader-patch'
import { presentOnly } from './fixtures/present-only'

const repo = join(__dirname, '..', '..', '..', '..', '..')
const installedGen = join(repo, 'node_modules', '@yowasp', 'clang', 'gen')
const installedBundle = readFileSync(join(installedGen, 'bundle.js'), 'utf8')

/**
 * A prepared package in memory: `exists` over the present paths, and `readText` answering `bundle` and recording each
 * path it was asked for.
 */
class MemoryPackage {
  readonly read: string[] = []
  private readonly files: ReturnType<typeof presentOnly>

  constructor(
    present: string[],
    private readonly bundle: string | Error,
  ) {
    this.files = presentOnly(present)
  }

  get asked(): string[] {
    return this.files.asked
  }

  exists(path: string): Promise<boolean> {
    return this.files.exists(path)
  }

  readText(path: string): Promise<string> {
    this.read.push(path)
    return this.bundle instanceof Error ? Promise.reject(this.bundle) : Promise.resolve(this.bundle)
  }
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

describe('checkWasmToolchainPackage', () => {
  const fileOf = (file: string): string => '/pkg/' + file
  const every = WASM_TOOLCHAIN_PACKAGE_FILES.map(fileOf)
  const patched = patchYowaspLoader(installedBundle)

  it('resolves for a package with every listed file and a patched bundle.js', async () => {
    const io = new MemoryPackage(every, patched)

    await expect(checkWasmToolchainPackage(fileOf, io)).resolves.toBeUndefined()
  })

  it('asks for every listed file under the package root and reads only gen/bundle.js, once', async () => {
    const io = new MemoryPackage(every, patched)

    await checkWasmToolchainPackage(fileOf, io)

    expect([...io.asked].sort()).toEqual([...every].sort())
    expect(io.read).toEqual(['/pkg/gen/bundle.js'])
  })

  it('names the first missing file in the package list and reads nothing', async () => {
    const io = new MemoryPackage(
      every.filter((path) => path !== '/pkg/gen/llvm.core4.wasm' && path !== '/pkg/gen/llvm-resources.tar'),
      patched,
    )

    const error = await checkWasmToolchainPackage(fileOf, io).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(Error)
    expect(error instanceof Error ? error.message : '').toBe('Missing toolchain file: /pkg/gen/llvm-resources.tar')
    expect(io.read).toEqual([])
  })

  it('reports a missing bundle.js as a missing file without reading it', async () => {
    const io = new MemoryPackage(
      every.filter((path) => path !== '/pkg/gen/bundle.js'),
      patched,
    )

    await expect(checkWasmToolchainPackage(fileOf, io)).rejects.toThrow('Missing toolchain file: /pkg/gen/bundle.js')
    expect(io.read).toEqual([])
  })

  it.each([
    ['the installed bundle.js', installedBundle],
    ['a bundle.js with the patched line but no change notice', patched.slice(patched.indexOf('\n') + 1)],
  ])('refuses %s as a loader that is not patched', async (_label, bundle) => {
    const io = new MemoryPackage(every, bundle)

    const error = await checkWasmToolchainPackage(fileOf, io).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(Error)
    expect(error instanceof Error ? error.message : '').toBe(
      "The toolchain's loader is not patched: /pkg/gen/bundle.js",
    )
  })

  it('passes on the error of a bundle.js that cannot be read, unchanged', async () => {
    const unreadable = new Error('EACCES: permission denied')
    const io = new MemoryPackage(every, unreadable)

    await expect(checkWasmToolchainPackage(fileOf, io)).rejects.toBe(unreadable)
  })
})
