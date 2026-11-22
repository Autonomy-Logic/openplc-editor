/**
 * Installs the pinned openplc-hmi-widgets release (the pre-installed HMI widget and HMI Alarms libraries) through the
 * platform's file and network mechanisms: the release's `SHA256SUMS` is checked against the pinned SHA-256, every file it
 * lists against it, and nothing is installed unless all of it checks out. A local build can stand in for the release
 * while it is not published.
 */
import {
  parseWidgetsReleaseSums,
  WIDGETS_RELEASE_SUMS,
  type WidgetsReleaseEntry,
  widgetsReleaseProblems,
} from '../../../../middleware/shared/utils/hmi/widget-libraries'

/** The `hmi-widgets` entry of `binary-versions.json`. */
export interface WidgetsReleasePin {
  /** Release tag, `v1.1.1`. */
  version: string
  /** GitHub repository, `Autonomy-Logic/openplc-hmi-widgets`. */
  repository: string
  /** SHA-256 of the release's `SHA256SUMS`. */
  sumsSha256: string
}

/** What the platform's setup script supplies. */
export interface WidgetsSetupMechanisms {
  /** A release asset's bytes, or null when the release or the asset does not exist (HTTP 404). */
  fetchAsset(url: string): Promise<Uint8Array | null>
  /** A file of the local build directory, or null when it is not there. */
  readOverride(dir: string, file: string): Promise<Uint8Array | null>
  /** A file of the installed release, or null when it is not there. */
  readInstalled(file: string): Promise<Uint8Array | null>
  /** Replaces the installed release with exactly these files. */
  writeInstalled(files: ReadonlyMap<string, Uint8Array>): Promise<void>
  log(message: string): void
}

export interface WidgetsSetupOptions {
  /** A local openplc-hmi-widgets build output directory (its `dist/`), used instead of the release. */
  overrideDir?: string
  /** Installs again even when the installed release checks out. */
  force?: boolean
}

/** Where the installed files came from, and the libraries (archive names) installed. */
export type WidgetsSetupResult = { source: 'installed' | 'release' | 'override'; libraries: string[] }

/** Environment variable naming a local build directory to install instead of the pinned release. */
export const WIDGETS_OVERRIDE_ENV = 'OPENPLC_HMI_WIDGETS_DIR'

export class WidgetsSetupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WidgetsSetupError'
  }
}

/** SHA-256 of `bytes` as lower-case hex. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

const decoder = new TextDecoder()

/** URL of a release asset. */
export function widgetsAssetUrl(pin: WidgetsReleasePin, file: string): string {
  return `https://github.com/${pin.repository}/releases/download/${pin.version}/${file}`
}

/** Library names of the archives a checksum list names. */
function libraryNames(entries: readonly WidgetsReleaseEntry[]): string[] {
  return entries.filter((e) => e.file.endsWith('.stlib')).map((e) => e.file.slice(0, -'.stlib'.length))
}

/** The release's files, checked against its checksum list; throws with every problem found. */
async function checkedRelease(
  sumsBytes: Uint8Array,
  read: (file: string) => Promise<Uint8Array | null>,
  where: string,
): Promise<{ entries: WidgetsReleaseEntry[]; files: Map<string, Uint8Array> }> {
  let entries: WidgetsReleaseEntry[]
  try {
    entries = parseWidgetsReleaseSums(decoder.decode(sumsBytes))
  } catch (error) {
    throw new WidgetsSetupError(`${where}: ${error instanceof Error ? error.message : String(error)}`)
  }
  const files = new Map<string, Uint8Array>([[WIDGETS_RELEASE_SUMS, sumsBytes]])
  const checked = []
  for (const entry of entries) {
    const bytes = await read(entry.file)
    if (bytes === null) continue
    files.set(entry.file, bytes)
    checked.push({ file: entry.file, sha256: await sha256Hex(bytes), text: decoder.decode(bytes) })
  }
  const problems = widgetsReleaseProblems(entries, checked)
  if (problems.length > 0) throw new WidgetsSetupError(`${where} cannot be installed:\n  ${problems.join('\n  ')}`)
  return { entries, files }
}

/** The installed libraries when the installed checksum list is the expected one and every file checks out. */
async function installedLibraries(
  expectedSha256: string,
  mechanisms: WidgetsSetupMechanisms,
): Promise<string[] | null> {
  const sums = await mechanisms.readInstalled(WIDGETS_RELEASE_SUMS)
  if (sums === null || (await sha256Hex(sums)) !== expectedSha256) return null
  try {
    const { entries } = await checkedRelease(sums, (f) => mechanisms.readInstalled(f), 'the installed HMI widgets')
    return libraryNames(entries)
  } catch {
    return null
  }
}

/**
 * Installs the pinned release, or the local build `options.overrideDir`. Skips the work when the same release is
 * installed and intact. Throws a `WidgetsSetupError` saying what to do when the release is not published, a hash
 * does not match, or an archive is not usable by this build.
 */
export async function setupWidgetsRelease(
  pin: WidgetsReleasePin,
  options: WidgetsSetupOptions,
  mechanisms: WidgetsSetupMechanisms,
): Promise<WidgetsSetupResult> {
  if (options.overrideDir) {
    const dir = options.overrideDir
    const sums = await mechanisms.readOverride(dir, WIDGETS_RELEASE_SUMS)
    if (sums === null)
      throw new WidgetsSetupError(
        `${WIDGETS_OVERRIDE_ENV}=${dir} has no ${WIDGETS_RELEASE_SUMS}: run npm run build in openplc-hmi-widgets`,
      )
    const sha = await sha256Hex(sums)
    if (!options.force) {
      const installed = await installedLibraries(sha, mechanisms)
      if (installed) return { source: 'installed', libraries: installed }
    }
    const { entries, files } = await checkedRelease(
      sums,
      (f) => mechanisms.readOverride(dir, f),
      `the local build ${dir}`,
    )
    if (sha !== pin.sumsSha256)
      mechanisms.log(
        `using the local build ${dir}; its ${WIDGETS_RELEASE_SUMS} SHA-256 ${sha} differs from the pinned ` +
          `${pin.version} (${pin.sumsSha256})`,
      )
    await mechanisms.writeInstalled(files)
    return { source: 'override', libraries: libraryNames(entries) }
  }

  if (!options.force) {
    const installed = await installedLibraries(pin.sumsSha256, mechanisms)
    if (installed) return { source: 'installed', libraries: installed }
  }
  const sumsUrl = widgetsAssetUrl(pin, WIDGETS_RELEASE_SUMS)
  const sums = await mechanisms.fetchAsset(sumsUrl)
  if (sums === null)
    throw new WidgetsSetupError(
      `The HMI widgets release ${pin.version} is not published on ${pin.repository} (${sumsUrl} was not found). ` +
        `Set ${WIDGETS_OVERRIDE_ENV} to a local openplc-hmi-widgets build directory (its dist/) to set up without it.`,
    )
  const sha = await sha256Hex(sums)
  if (sha !== pin.sumsSha256)
    throw new WidgetsSetupError(
      `${sumsUrl} has SHA-256 ${sha}, but binary-versions.json pins ${pin.sumsSha256}: the release does not ` +
        'match the pin, so nothing was installed.',
    )
  const { entries, files } = await checkedRelease(
    sums,
    (f) => mechanisms.fetchAsset(widgetsAssetUrl(pin, f)),
    `the HMI widgets release ${pin.version}`,
  )
  await mechanisms.writeInstalled(files)
  return { source: 'release', libraries: libraryNames(entries) }
}

/** Reads the `hmi-widgets` pin of a parsed `binary-versions.json`; throws when it is missing or incomplete. */
export function widgetsReleasePin(versions: unknown): WidgetsReleasePin {
  const entry =
    typeof versions === 'object' && versions !== null && 'hmi-widgets' in versions ? versions['hmi-widgets'] : null
  if (
    typeof entry !== 'object' ||
    entry === null ||
    !('version' in entry) ||
    !('repository' in entry) ||
    !('sumsSha256' in entry) ||
    typeof entry.version !== 'string' ||
    typeof entry.repository !== 'string' ||
    typeof entry.sumsSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(entry.sumsSha256)
  )
    throw new WidgetsSetupError(
      'binary-versions.json needs an "hmi-widgets" entry with "version", "repository" and "sumsSha256"',
    )
  return { version: entry.version, repository: entry.repository, sumsSha256: entry.sumsSha256 }
}
