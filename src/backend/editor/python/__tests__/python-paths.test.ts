/**
 * @jest-environment node
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from '@jest/globals'

import { readPinnedPythonFiles, resolvePythonRuntimePaths } from '../python-paths'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'python-paths-'))
  roots.push(root)
  return root
}

function writeManifest(dir: string, python: string, numpy: string): string {
  mkdirSync(dir, { recursive: true })
  const manifest = join(dir, 'python-runtime.json')
  writeFileSync(
    manifest,
    JSON.stringify({
      python: { file: python, url: 'https://example.invalid/python', sha256: '0'.repeat(64) },
      numpy: { file: numpy, url: 'https://example.invalid/numpy', sha256: '1'.repeat(64) },
    }),
  )
  return manifest
}

describe('readPinnedPythonFiles', () => {
  it('reads the pinned file names from a manifest on disk', () => {
    const manifest = writeManifest(tempRoot(), 'python-a.webc', 'numpy-a.whl')

    expect(readPinnedPythonFiles(manifest)).toEqual({ python: 'python-a.webc', numpy: 'numpy-a.whl' })
  })

  it('throws when the manifest is missing', () => {
    expect(() => readPinnedPythonFiles(join(tempRoot(), 'python-runtime.json'))).toThrow(/ENOENT/)
  })

  it('throws when the manifest names no file for a runtime part', () => {
    const manifest = join(tempRoot(), 'python-runtime.json')
    writeFileSync(manifest, JSON.stringify({ python: { file: 'python.webc' } }))

    expect(() => readPinnedPythonFiles(manifest)).toThrow("python-runtime.json has no file for 'numpy'.")
  })
})

describe('resolvePythonRuntimePaths', () => {
  it('takes the runtime, its manifest and the Wasmer SDK from the extra resources when packaged', () => {
    const resourcesPath = tempRoot()
    const cwd = tempRoot()
    writeManifest(join(resourcesPath, 'python-runtime'), 'python-packaged.webc', 'numpy-packaged.whl')
    writeManifest(cwd, 'python-repo.webc', 'numpy-repo.whl')

    expect(resolvePythonRuntimePaths({ isPackaged: true, resourcesPath, cwd, mainDir: '/app/main' })).toEqual({
      workerScript: join('/app/main', 'python-worker.js'),
      sdkEntry: join(resourcesPath, 'wasmer-sdk', 'dist', 'node.js'),
      pythonPackage: join(resourcesPath, 'python-runtime', 'python-packaged.webc'),
      numpyWheel: join(resourcesPath, 'python-runtime', 'numpy-packaged.whl'),
    })
  })

  it('takes the runtime from vendor/, the manifest from the repository root and the SDK from node_modules otherwise', () => {
    const resourcesPath = tempRoot()
    const cwd = tempRoot()
    writeManifest(join(resourcesPath, 'python-runtime'), 'python-packaged.webc', 'numpy-packaged.whl')
    writeManifest(cwd, 'python-repo.webc', 'numpy-repo.whl')

    expect(resolvePythonRuntimePaths({ isPackaged: false, resourcesPath, cwd, mainDir: '/repo/dist' })).toEqual({
      workerScript: join('/repo/dist', 'python-worker.js'),
      sdkEntry: join(cwd, 'node_modules', '@wasmer', 'sdk', 'dist', 'node.js'),
      pythonPackage: join(cwd, 'vendor', 'python-runtime', 'python-repo.webc'),
      numpyWheel: join(cwd, 'vendor', 'python-runtime', 'numpy-repo.whl'),
    })
  })

  it('throws when the packaged app has no manifest', () => {
    const cwd = tempRoot()
    writeManifest(cwd, 'python-repo.webc', 'numpy-repo.whl')

    expect(() =>
      resolvePythonRuntimePaths({ isPackaged: true, resourcesPath: tempRoot(), cwd, mainDir: '/app/main' }),
    ).toThrow(/ENOENT/)
  })

  it('throws when the repository has no manifest', () => {
    const resourcesPath = tempRoot()
    writeManifest(join(resourcesPath, 'python-runtime'), 'python-packaged.webc', 'numpy-packaged.whl')

    expect(() =>
      resolvePythonRuntimePaths({ isPackaged: false, resourcesPath, cwd: tempRoot(), mainDir: '/repo/dist' }),
    ).toThrow(/ENOENT/)
  })
})
