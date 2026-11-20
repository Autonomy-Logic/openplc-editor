/**
 * What every build provides to library code, the HMI core API version an archive was compiled against, and the
 * checksum list of an openplc-hmi-widgets release. A library is a plain STruC++ archive: its chunks record the headers they need,
 * and a build states the headers it provides, so a POU that calls the HMI core is usable by HMI builds only.
 */
/**
 * API version of the HMI C core that library code calls: the `HMI_CORE_API_VERSION` macro of
 * `resources/sources/hmi/core/hmi_core.h`, raised together with it.
 */
export const HMI_CORE_API_VERSION = 1

/** The HMI core header, as library chunks name it in their header requirements. */
export const HMI_CORE_HEADER = 'hmi_core.h'

/** A header a build provides to library code, with its API version. */
export interface ProvidedHeader {
  name: string
  version?: string
}

/** Headers an HMI build (preview, thumbnails, Runtime v4 module, panel firmware) provides: the HMI core. */
export const HMI_PROVIDED_HEADERS: readonly ProvidedHeader[] = [
  { name: HMI_CORE_HEADER, version: String(HMI_CORE_API_VERSION) },
]

/** Headers a PLC build provides beyond the runtime's own: none. */
export const PLC_PROVIDED_HEADERS: readonly ProvidedHeader[] = []

/** File name of a release's checksum list, the release's only index. */
export const WIDGETS_RELEASE_SUMS = 'SHA256SUMS'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The archive's manifest name, or `?` when it has none. */
export function libraryArchiveName(archive: unknown): string {
  const manifest = isRecord(archive) ? archive.manifest : undefined
  return isRecord(manifest) && typeof manifest.name === 'string' ? manifest.name : '?'
}

/** Every version of `header` an archive's manifest or chunks require, in the order first met. */
function requiredHeaderVersions(archive: unknown, header: string): string[] {
  const versions: string[] = []
  const add = (version: unknown) => {
    if (typeof version === 'string' && !versions.includes(version)) versions.push(version)
  }
  if (!isRecord(archive)) return versions
  const manifest = archive.manifest
  if (isRecord(manifest) && isRecord(manifest.headerVersions)) add(manifest.headerVersions[header])
  const chunks = Array.isArray(archive.chunks) ? archive.chunks : []
  for (const chunk of chunks) {
    const headers = isRecord(chunk) && Array.isArray(chunk.headers) ? chunk.headers : []
    for (const h of headers) if (isRecord(h) && h.name === header) add(h.version)
  }
  return versions
}

/** A library compiled against another HMI core API than this editor's: the API it requires and the one provided. */
export interface HmiCoreApiMismatch {
  name: string
  required: string
  provided: string
}

/** The HMI core API mismatch of an archive whose code needs another version of the core, or null when none does. */
export function hmiCoreApiMismatch(archive: unknown): HmiCoreApiMismatch | null {
  const provided = String(HMI_CORE_API_VERSION)
  const required = requiredHeaderVersions(archive, HMI_CORE_HEADER).find((v) => v !== provided)
  return required === undefined ? null : { name: libraryArchiveName(archive), required, provided }
}

/** The warning for a library HMI builds leave out because its code needs another HMI core API. */
export function skippedLibraryMessage(mismatch: HmiCoreApiMismatch): string {
  return (
    `The library "${mismatch.name}" is left out of HMI builds: it is built for HMI core API ` +
    `${mismatch.required}, but this editor provides HMI core API ${mismatch.provided}. Install a build of the ` +
    `library for HMI core API ${mismatch.provided}.`
  )
}

/** The library manager's warning for an installed archive HMI builds leave out, or null when they use it. */
export function libraryArchiveWarning(archive: unknown): string | null {
  const mismatch = hmiCoreApiMismatch(archive)
  return mismatch ? skippedLibraryMessage(mismatch) : null
}

/** Names of the pre-installed libraries among library manager rows: always on for every project. */
export function bundledLibraryNames(rows: ReadonlyArray<{ name: string; bundled: boolean }>): string[] {
  return rows.filter((row) => row.bundled).map((row) => row.name)
}

/** One file of a release, as its checksum list names it. */
export interface WidgetsReleaseEntry {
  file: string
  sha256: string
}

const SUMS_LINE = /^([0-9a-f]{64}) [ *]([A-Za-z0-9][A-Za-z0-9._-]*)$/

/** Parses a release's `SHA256SUMS` (`sha256sum` format); throws with the reason when a line is not a plain file entry. */
export function parseWidgetsReleaseSums(text: string): WidgetsReleaseEntry[] {
  const entries: WidgetsReleaseEntry[] = []
  for (const [index, line] of text.split('\n').entries()) {
    if (line.trim() === '') continue
    const match = SUMS_LINE.exec(line)
    if (!match) throw new Error(`${WIDGETS_RELEASE_SUMS} line ${index + 1} is not "<sha256>  <file>"`)
    const [, sha256, file] = match
    if (entries.some((e) => e.file === file)) throw new Error(`${WIDGETS_RELEASE_SUMS} lists ${file} twice`)
    entries.push({ file, sha256 })
  }
  if (!entries.some((e) => e.file.endsWith('.stlib')))
    throw new Error(`${WIDGETS_RELEASE_SUMS} lists no .stlib archive`)
  return entries
}

/** One file of a release as read, with the SHA-256 of its bytes. */
export interface WidgetsReleaseFile {
  file: string
  sha256: string
  text: string
}

/**
 * What is wrong with a release's files: a missing file, a hash that differs from the checksum list, an archive that
 * does not hold the library its file is named after, or one whose code needs another HMI core API. Empty when it can be
 * installed.
 */
export function widgetsReleaseProblems(
  entries: readonly WidgetsReleaseEntry[],
  files: readonly WidgetsReleaseFile[],
): string[] {
  const problems: string[] = []
  const byFile = new Map(files.map((f) => [f.file, f]))
  for (const entry of entries) {
    const found = byFile.get(entry.file)
    if (!found) {
      problems.push(`${entry.file} is missing`)
      continue
    }
    if (found.sha256 !== entry.sha256) {
      problems.push(`${entry.file} has SHA-256 ${found.sha256}, ${WIDGETS_RELEASE_SUMS} says ${entry.sha256}`)
      continue
    }
    if (!entry.file.endsWith('.stlib')) continue
    let archive: unknown
    try {
      archive = JSON.parse(found.text)
    } catch {
      problems.push(`${entry.file} is not JSON`)
      continue
    }
    const name = entry.file.slice(0, -'.stlib'.length)
    if (libraryArchiveName(archive) !== name) problems.push(`${entry.file} is not the library ${name}`)
    const mismatch = hmiCoreApiMismatch(archive)
    if (mismatch)
      problems.push(
        `${entry.file} is built for HMI core API ${mismatch.required}, but this editor provides HMI core API ` +
          mismatch.provided,
      )
  }
  return problems
}
