import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { parsePythonRuntimeManifest, type PinnedPythonFiles } from '@root/backend/shared/python/python-runtime-files'

export interface PythonRuntimeLocation {
  isPackaged: boolean
  resourcesPath: string
  cwd: string
  /** The directory of the built main process, which also holds the built `python-worker.js`. */
  mainDir: string
}

export interface PythonRuntimePaths {
  workerScript: string
  /** The Wasmer SDK's Node entry point. */
  sdkEntry: string
  pythonPackage: string
  numpyWheel: string
}

/** The file names `python-runtime.json` pins, which the install script downloads under those names. */
export function readPinnedPythonFiles(manifestPath: string): PinnedPythonFiles {
  return parsePythonRuntimeManifest(readFileSync(manifestPath, 'utf8'))
}

/**
 * Where the Python worker, the Wasmer SDK and the runtime files live. A packaged app ships the SDK and the runtime as
 * extra resources outside the asar archive (with the pin manifest); anything else uses the repository's.
 */
export function resolvePythonRuntimePaths(location: PythonRuntimeLocation): PythonRuntimePaths {
  const runtimeDir = location.isPackaged
    ? join(location.resourcesPath, 'python-runtime')
    : join(location.cwd, 'vendor', 'python-runtime')
  const manifest = location.isPackaged
    ? join(runtimeDir, 'python-runtime.json')
    : join(location.cwd, 'python-runtime.json')
  const files = readPinnedPythonFiles(manifest)
  const sdkDir = location.isPackaged
    ? join(location.resourcesPath, 'wasmer-sdk')
    : join(location.cwd, 'node_modules', '@wasmer', 'sdk')
  return {
    workerScript: join(location.mainDir, 'python-worker.js'),
    sdkEntry: join(sdkDir, 'dist', 'node.js'),
    pythonPackage: join(runtimeDir, files.python),
    numpyWheel: join(runtimeDir, files.numpy),
  }
}
