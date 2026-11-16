/**
 * @jest-environment node
 * @vitest-environment node
 */
import { describe, expect, it } from '@jest/globals'

import { parsePythonRuntimeManifest, parsePythonThreadInit, pythonThreadInit } from '../python-runtime-files'

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

  it('reads the URLs from the message the page sends', () => {
    expect(parsePythonThreadInit(pythonThreadInit(urls))).toEqual(urls)
  })

  it('reads an init message that says nothing about compression, and returns only the three URLs', () => {
    const parsed = parsePythonThreadInit({ type: 'init', location: { ...urls } })

    expect(parsed).toEqual(urls)
    expect(Object.keys(parsed ?? {}).sort()).toEqual(['packageUrl', 'sdkUrl', 'wheelUrl'])
  })

  it('does not carry a compression flag a page still sends', () => {
    const parsed = parsePythonThreadInit({ type: 'init', location: { ...urls, packageCompressed: true } })

    expect(Object.keys(parsed ?? {}).sort()).toEqual(['packageUrl', 'sdkUrl', 'wheelUrl'])
  })

  it('sends only the three URLs in the init message', () => {
    expect(pythonThreadInit(urls)).toStrictEqual({ type: 'init', location: urls })
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
