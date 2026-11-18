import { parseRuntimeFileCacheRef, type RuntimeFileCacheRef } from '../wasm-toolchain/runtime-file-cache'
import { requireFiles } from '../wasm-toolchain/toolchain-files'

/** The file names `python-runtime.json` pins, which the install script downloads under those names. */
export interface PinnedPythonFiles {
  python: string
  numpy: string
}

const pinnedFile = (pins: unknown, key: string): string => {
  const entry: unknown = typeof pins === 'object' && pins !== null ? Reflect.get(pins, key) : null
  const file: unknown = typeof entry === 'object' && entry !== null ? Reflect.get(entry, 'file') : null
  if (typeof file !== 'string' || file.length === 0) throw new Error(`python-runtime.json has no file for '${key}'.`)
  return file
}

/** Parses the text of `python-runtime.json`; throws when it is not JSON or names no file for a runtime part. */
export function parsePythonRuntimeManifest(text: string): PinnedPythonFiles {
  const pins: unknown = JSON.parse(text)
  return { python: pinnedFile(pins, 'python'), numpy: pinnedFile(pins, 'numpy') }
}

/** Where a platform keeps the Python runtime's files. */
export interface PythonRuntimeFilePaths {
  /** The Wasmer SDK's entry point. */
  sdkEntry: string
  /** The CPython package (WEBC). */
  pythonPackage: string
  /** The numpy wheel. */
  numpyWheel: string
}

/**
 * Checks the Python runtime's files are present, starting nothing.
 * @throws {Error} `Missing Python runtime file: <path>` for the first missing one, in the order SDK entry, CPython package, numpy wheel.
 */
export function requirePythonRuntimeFiles(
  paths: PythonRuntimeFilePaths,
  exists: (path: string) => Promise<boolean>,
): Promise<void> {
  return requireFiles([paths.sdkEntry, paths.pythonPackage, paths.numpyWheel], exists, 'Python runtime')
}

/** Where a page serves the Python runtime. */
export interface PythonRuntimeUrls {
  /** The Wasmer SDK's browser entry point. */
  sdkUrl: string
  /** The CPython package (WEBC). */
  packageUrl: string
  /** The numpy wheel. */
  wheelUrl: string
}

/** The first message a page sends its Python thread: where the runtime is served and where its stored files are. */
export interface PythonThreadInit {
  type: 'init'
  location: PythonRuntimeUrls
  cache: RuntimeFileCacheRef | null
}

export const pythonThreadInit = (
  location: PythonRuntimeUrls,
  cache: RuntimeFileCacheRef | null = null,
): PythonThreadInit => ({
  type: 'init',
  location: { ...location },
  cache: cache && { name: cache.name, urls: [...cache.urls] },
})

/** The init message, or `null` for any other message; a missing or malformed cache reference reads as `null`. */
export function parsePythonThreadInit(message: unknown): PythonThreadInit | null {
  if (typeof message !== 'object' || message === null || Reflect.get(message, 'type') !== 'init') return null
  const where: unknown = Reflect.get(message, 'location')
  if (typeof where !== 'object' || where === null) return null
  const sdkUrl: unknown = Reflect.get(where, 'sdkUrl')
  const packageUrl: unknown = Reflect.get(where, 'packageUrl')
  const wheelUrl: unknown = Reflect.get(where, 'wheelUrl')
  if (typeof sdkUrl !== 'string' || typeof packageUrl !== 'string' || typeof wheelUrl !== 'string') return null
  return {
    type: 'init',
    location: { sdkUrl, packageUrl, wheelUrl },
    cache: parseRuntimeFileCacheRef(Reflect.get(message, 'cache')),
  }
}
