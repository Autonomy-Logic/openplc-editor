/**
 * Where the bundled Python runtime's files are: the names `python-runtime.json` pins (the desktop reads them to find
 * the downloaded files), and the URLs a web page serves them from, which its Python thread receives first in an
 * `init` message. Platforms read and send these; the checks live here.
 */

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

/** Where a page serves the Python runtime. */
export interface PythonRuntimeUrls {
  /** The Wasmer SDK's browser entry point. */
  sdkUrl: string
  /** The CPython package (WEBC). */
  packageUrl: string
  /** Whether the package is served gzip-compressed. */
  packageCompressed: boolean
  /** The numpy wheel. */
  wheelUrl: string
}

/** The first message a page sends its Python thread. */
export interface PythonThreadInit {
  type: 'init'
  location: PythonRuntimeUrls
}

export const pythonThreadInit = (location: PythonRuntimeUrls): PythonThreadInit => ({
  type: 'init',
  location: { ...location },
})

/** The runtime's URLs from an `init` message, or `null` for any other message. */
export function parsePythonThreadInit(message: unknown): PythonRuntimeUrls | null {
  if (typeof message !== 'object' || message === null || Reflect.get(message, 'type') !== 'init') return null
  const where: unknown = Reflect.get(message, 'location')
  if (typeof where !== 'object' || where === null) return null
  const sdkUrl: unknown = Reflect.get(where, 'sdkUrl')
  const packageUrl: unknown = Reflect.get(where, 'packageUrl')
  const packageCompressed: unknown = Reflect.get(where, 'packageCompressed')
  const wheelUrl: unknown = Reflect.get(where, 'wheelUrl')
  if (
    typeof sdkUrl !== 'string' ||
    typeof packageUrl !== 'string' ||
    typeof packageCompressed !== 'boolean' ||
    typeof wheelUrl !== 'string'
  ) {
    return null
  }
  return { sdkUrl, packageUrl, packageCompressed, wheelUrl }
}
