import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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

interface PinnedFiles {
  python: string
  numpy: string
}

const fileOf = (pins: unknown, key: string): string => {
  const entry: unknown = typeof pins === 'object' && pins !== null ? Reflect.get(pins, key) : null
  const file: unknown = typeof entry === 'object' && entry !== null ? Reflect.get(entry, 'file') : null
  if (typeof file !== 'string') throw new Error(`python-runtime.json has no file for '${key}'.`)
  return file
}

/** The file names `python-runtime.json` pins, which the install script downloads under those names. */
export function readPinnedPythonFiles(manifestPath: string): PinnedFiles {
  const pins: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
  return { python: fileOf(pins, 'python'), numpy: fileOf(pins, 'numpy') }
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
