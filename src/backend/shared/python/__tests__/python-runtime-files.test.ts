/**
 * @jest-environment node
 * @vitest-environment node
 */
import { describe, expect, it } from '@jest/globals'

import { presentOnly } from '../../wasm-toolchain/__tests__/fixtures/present-only'
import {
  parsePythonRuntimeManifest,
  parsePythonThreadInit,
  type PythonRuntimeFilePaths,
  pythonThreadInit,
  requirePythonRuntimeFiles,
} from '../python-runtime-files'

describe('parsePythonRuntimeManifest', () => {
  it('reads the pinned file names', () => {
    const text = JSON.stringify({
      python: { file: 'python-3.13.19.webc', sha256: 'a' },
      numpy: { file: 'numpy.whl', sha256: 'b' },
    })
    expect(parsePythonRuntimeManifest(text)).toEqual({ python: 'python-3.13.19.webc', numpy: 'numpy.whl' })
  })

  it('names the part that has no file, and refuses text that is not JSON', () => {
    expect(() => parsePythonRuntimeManifest(JSON.stringify({ python: { file: 'p.webc' } }))).toThrow(
      "python-runtime.json has no file for 'numpy'.",
    )
    expect(() => parsePythonRuntimeManifest(JSON.stringify({ python: { file: '' }, numpy: { file: 'n' } }))).toThrow(
      "no file for 'python'",
    )
    expect(() => parsePythonRuntimeManifest('not json')).toThrow()
  })
})

describe('parsePythonThreadInit', () => {
  const urls = {
    sdkUrl: '/python-runtime/sdk/dist/index.js',
    packageUrl: '/python-runtime/python-3.13.19.webc',
    wheelUrl: '/python-runtime/numpy.whl',
  }

  const cache = {
    name: 'openplc-runtime-files/python-runtime-0123456789ab',
    urls: ['/python-runtime/python-3.13.19.webc', '/python-runtime/numpy.whl'],
  }

  it('reads the whole init message the page sends, with no cache reference when none is given', () => {
    expect(parsePythonThreadInit(pythonThreadInit(urls))).toEqual({ type: 'init', location: urls, cache: null })
  })

  it('carries the cache reference from the page to the thread', () => {
    expect(parsePythonThreadInit(pythonThreadInit(urls, cache))).toEqual({ type: 'init', location: urls, cache })
  })

  it('reads an init message that says nothing about compression, and returns only the three URLs', () => {
    const parsed = parsePythonThreadInit({ type: 'init', location: { ...urls } })

    expect(parsed?.location).toEqual(urls)
    expect(Object.keys(parsed?.location ?? {}).sort()).toEqual(['packageUrl', 'sdkUrl', 'wheelUrl'])
  })

  it('does not carry a compression flag a page still sends', () => {
    const parsed = parsePythonThreadInit({ type: 'init', location: { ...urls, packageCompressed: true } })

    expect(Object.keys(parsed?.location ?? {}).sort()).toEqual(['packageUrl', 'sdkUrl', 'wheelUrl'])
  })

  it('sends only the three URLs and the cache reference in the init message', () => {
    expect(pythonThreadInit(urls)).toStrictEqual({ type: 'init', location: urls, cache: null })
    expect(pythonThreadInit(urls, cache)).toStrictEqual({ type: 'init', location: urls, cache })
  })

  it.each([
    ['missing', {}],
    ['null', { cache: null }],
    ['named outside the runtime file caches', { cache: { ...cache, name: 'workbox-precache-v1' } }],
    ['with urls that are not a list', { cache: { ...cache, urls: 'numpy.whl' } }],
    ['with a url that is not a string', { cache: { ...cache, urls: [null] } }],
  ])('reads a cache reference that is %s as no cache', (_label, extra) => {
    expect(parsePythonThreadInit({ type: 'init', location: { ...urls }, ...extra })).toEqual({
      type: 'init',
      location: urls,
      cache: null,
    })
  })

  it('ignores other messages and an init with a missing or mistyped field', () => {
    expect(parsePythonThreadInit({ type: 'spawn', id: 1 })).toBeNull()
    expect(parsePythonThreadInit(null)).toBeNull()
    expect(parsePythonThreadInit({ type: 'init' })).toBeNull()
    expect(parsePythonThreadInit({ type: 'init', location: { ...urls, packageUrl: 1 } })).toBeNull()
    expect(parsePythonThreadInit({ type: 'init', location: { ...urls, sdkUrl: null } })).toBeNull()
    expect(parsePythonThreadInit({ type: 'init', location: { ...urls, wheelUrl: undefined } })).toBeNull()
  })
})

describe('requirePythonRuntimeFiles', () => {
  const paths: PythonRuntimeFilePaths = {
    sdkEntry: '/runtime/sdk/dist/index.js',
    pythonPackage: '/runtime/python-3.13.19.webc',
    numpyWheel: '/runtime/numpy.whl',
  }

  it('resolves when the SDK entry, the CPython package and the numpy wheel exist', async () => {
    const { exists } = presentOnly([paths.sdkEntry, paths.pythonPackage, paths.numpyWheel])

    await expect(requirePythonRuntimeFiles(paths, exists)).resolves.toBeUndefined()
  })

  it('names the CPython package when only it is missing', async () => {
    const { exists } = presentOnly([paths.sdkEntry, paths.numpyWheel])

    await expect(requirePythonRuntimeFiles(paths, exists)).rejects.toThrow(
      'Missing Python runtime file: /runtime/python-3.13.19.webc',
    )
  })

  it('names the SDK entry first when none of the files is present', async () => {
    const { exists } = presentOnly([])

    const error = await requirePythonRuntimeFiles(paths, exists).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(Error)
    expect(error instanceof Error ? error.message : '').toBe('Missing Python runtime file: /runtime/sdk/dist/index.js')
  })

  it('names the CPython package before the numpy wheel when both are missing', async () => {
    const { exists } = presentOnly([paths.sdkEntry])

    await expect(requirePythonRuntimeFiles(paths, exists)).rejects.toThrow(
      'Missing Python runtime file: /runtime/python-3.13.19.webc',
    )
  })

  it('asks only for the three runtime files of a paths object that has other fields', async () => {
    const { asked, exists } = presentOnly([paths.sdkEntry, paths.pythonPackage, paths.numpyWheel])
    const desktopPaths = { ...paths, workerScript: '/app/dist/python-worker.js' }

    await requirePythonRuntimeFiles(desktopPaths, exists)

    expect([...asked].sort()).toEqual([paths.numpyWheel, paths.pythonPackage, paths.sdkEntry].sort())
  })
})
