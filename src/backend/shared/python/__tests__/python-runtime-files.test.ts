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
    sdkUrl: '/python-runtime/sdk/index.mjs',
    packageUrl: '/python-runtime/python.webc.gz',
    packageCompressed: true,
    wheelUrl: '/python-runtime/numpy.whl',
  }

  it('reads the URLs from the message the page sends', () => {
    expect(parsePythonThreadInit(pythonThreadInit(urls))).toEqual(urls)
  })

  it('ignores other messages and an init with a missing or mistyped field', () => {
    expect(parsePythonThreadInit({ type: 'spawn', id: 1 })).toBeNull()
    expect(parsePythonThreadInit(null)).toBeNull()
    expect(parsePythonThreadInit({ type: 'init' })).toBeNull()
    expect(parsePythonThreadInit({ type: 'init', location: { ...urls, packageCompressed: 'yes' } })).toBeNull()
    expect(parsePythonThreadInit({ type: 'init', location: { ...urls, wheelUrl: undefined } })).toBeNull()
  })
})
