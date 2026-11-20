/**
 * What every build provides to library code, the HMI core API version an archive was compiled against, and the
 * openplc-hmi-widgets release manifest. A library is a plain STruC++ archive: its chunks record the headers they need,
 * and a build states the headers it provides, so a POU that calls the HMI core is usable by HMI builds only.
 */
import { z } from 'zod'

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

/** Release manifest format versions this build reads; format 1 also carries fields this build ignores. */
export const WIDGETS_RELEASE_FORMATS: readonly number[] = [1, 2]

/** File name of the release manifest among a release's assets. */
export const WIDGETS_RELEASE_MANIFEST = 'openplc-hmi-widgets.json'

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

const releaseSchema = z.object({
  formatVersion: z.number(),
  name: z.literal('openplc-hmi-widgets'),
  version: z.string(),
  strucppVersion: z.string(),
  archives: z.array(
    z.object({
      name: z.string().regex(/^[a-z][a-z0-9-]*$/),
      displayName: z.string(),
      version: z.string(),
      file: z.string().regex(/^[a-z][a-z0-9-]*\.stlib$/),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      size: z.number().int().nonnegative(),
      strucppVersion: z.string(),
      headers: z.array(z.string()),
      license: z.string(),
    }),
  ),
})

export type WidgetsRelease = z.infer<typeof releaseSchema>

/** Parses an openplc-hmi-widgets release manifest; throws with the reason when it is not one this build reads. */
export function parseWidgetsRelease(text: string): WidgetsRelease {
  const raw: unknown = JSON.parse(text)
  if (isRecord(raw) && typeof raw.formatVersion === 'number' && !WIDGETS_RELEASE_FORMATS.includes(raw.formatVersion))
    throw new Error(
      `The HMI widget release manifest is format ${raw.formatVersion}; this build reads formats ` +
        WIDGETS_RELEASE_FORMATS.join(' and '),
    )
  const parsed = releaseSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(`The HMI widget release manifest is invalid at ${issue?.path.join('.')}: ${issue?.message}`)
  }
  return parsed.data
}

/** One archive of a release as read from disk, with the SHA-256 of its bytes. */
export interface WidgetsReleaseFile {
  file: string
  sha256: string
  text: string
}

/**
 * What is wrong with a release's archives: a missing file, a hash that differs from the manifest, an archive that is
 * not the library the manifest names, or one whose code needs another HMI core API. Empty when it can be installed.
 */
export function widgetsReleaseProblems(release: WidgetsRelease, files: readonly WidgetsReleaseFile[]): string[] {
  const problems: string[] = []
  const byFile = new Map(files.map((f) => [f.file, f]))
  for (const entry of release.archives) {
    const found = byFile.get(entry.file)
    if (!found) {
      problems.push(`${entry.file} is missing`)
      continue
    }
    if (found.sha256 !== entry.sha256) {
      problems.push(`${entry.file} has SHA-256 ${found.sha256}, the manifest says ${entry.sha256}`)
      continue
    }
    let archive: unknown
    try {
      archive = JSON.parse(found.text)
    } catch {
      problems.push(`${entry.file} is not JSON`)
      continue
    }
    if (libraryArchiveName(archive) !== entry.name) problems.push(`${entry.file} is not the library ${entry.name}`)
    const mismatch = hmiCoreApiMismatch(archive)
    if (mismatch)
      problems.push(
        `${entry.file} is built for HMI core API ${mismatch.required}, but this editor provides HMI core API ` +
          mismatch.provided,
      )
  }
  return problems
}
