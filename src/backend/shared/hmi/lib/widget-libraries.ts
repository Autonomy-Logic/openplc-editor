/**
 * The project's libraries (bundled and listed) as HMI builds see them: every archive, loaded for STruC++, with the
 * widget catalogue derived from their manifests. A library whose code needs another HMI core API is left out with a
 * warning. Nothing here compiles a library.
 */
import {
  type HmiCoreApiMismatch,
  hmiCoreApiMismatch,
  libraryArchiveName,
  skippedLibraryMessage,
} from '@root/middleware/shared/utils/hmi/widget-libraries'
import type { StlibArchive } from 'strucpp'

import type {
  HmiDiagnostic,
  HmiWidgetCatalog,
  HmiWidgetInfo,
} from '../../../../middleware/shared/ports/hmi-preview-types'
import { loadStrucpp, type StrucppRuntime } from '../../library/strucpp-runtime'
import { buildWidgetCatalog } from './widget-catalog'

/** A library ready for STruC++, with its archive as JSON. */
export interface HmiWidgetLibraryArchive {
  name: string
  archive: StlibArchive
  archiveJson: string
}

/** A library HMI builds leave out, built for another HMI core API, with the names (upper case) it declares. */
export interface SkippedWidgetLibrary extends HmiCoreApiMismatch {
  names: string[]
}

export interface HmiWidgetLibrarySet {
  libraries: HmiWidgetLibraryArchive[]
  /** Widgets of every loaded library, the first library winning a name. */
  catalog: HmiWidgetCatalog
  errors: HmiDiagnostic[]
  warnings: HmiDiagnostic[]
  skipped: SkippedWidgetLibrary[]
}

const DIAGNOSTIC_FILE = 'HMI'

/** Loaded libraries by the archive object they came from, so a list loaded once is not parsed again. */
const loadedCache = new WeakMap<object, HmiWidgetLibraryArchive>()

/** The catalogue of the last library list, by the identity of its archives. */
let catalogCache: { archives: readonly StlibArchive[]; catalog: HmiWidgetCatalog } | null = null

function loadOne(raw: object, strucpp: Pick<StrucppRuntime, 'loadStlibFromString'>): HmiWidgetLibraryArchive {
  const cached = loadedCache.get(raw)
  if (cached) return cached
  const name = libraryArchiveName(raw)
  const archiveJson = JSON.stringify(raw)
  const loaded = { name, archive: strucpp.loadStlibFromString(archiveJson, name), archiveJson }
  loadedCache.set(raw, loaded)
  return loaded
}

function catalogOf(archives: readonly StlibArchive[]): HmiWidgetCatalog {
  const same =
    catalogCache !== null &&
    catalogCache.archives.length === archives.length &&
    catalogCache.archives.every((a, i) => a === archives[i])
  if (catalogCache !== null && same) return catalogCache.catalog
  const catalog = buildWidgetCatalog(archives)
  catalogCache = { archives: [...archives], catalog }
  return catalog
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Names (upper case) an archive's manifest declares. */
function declaredNames(archive: unknown): string[] {
  const manifest = isRecord(archive) ? archive.manifest : undefined
  if (!isRecord(manifest)) return []
  const names: string[] = []
  for (const key of ['functions', 'functionBlocks', 'types', 'globals', 'interfaces']) {
    const list = manifest[key]
    if (!Array.isArray(list)) continue
    for (const entry of list)
      if (isRecord(entry) && typeof entry.name === 'string') names.push(entry.name.toUpperCase())
  }
  return names
}

/**
 * Every archive among `archives` (verbatim), loaded, in order, with the widget catalogue they give. One built
 * for another HMI core API is left out with a warning; one that does not load, with an error; a second library of the
 * same name is left out. No widget among them is an error.
 */
export function loadHmiWidgetLibraries(
  archives: readonly unknown[],
  strucpp: Pick<StrucppRuntime, 'loadStlibFromString'> = loadStrucpp(),
): HmiWidgetLibrarySet {
  const libraries: HmiWidgetLibraryArchive[] = []
  const errors: HmiDiagnostic[] = []
  const warnings: HmiDiagnostic[] = []
  const skipped: SkippedWidgetLibrary[] = []
  const names = new Set<string>()
  for (const raw of archives) {
    if (typeof raw !== 'object' || raw === null) continue
    const name = libraryArchiveName(raw)
    const mismatch = hmiCoreApiMismatch(raw)
    if (mismatch) {
      if (skipped.some((s) => s.name === name)) continue
      warnings.push({ file: DIAGNOSTIC_FILE, message: skippedLibraryMessage(mismatch) })
      skipped.push({ ...mismatch, names: declaredNames(raw) })
      continue
    }
    if (names.has(name)) continue
    try {
      libraries.push(loadOne(raw, strucpp))
      names.add(name)
    } catch (error) {
      errors.push({
        file: DIAGNOSTIC_FILE,
        message: `The library "${name}" could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }
  const catalog = catalogOf(libraries.map((l) => l.archive))
  if (catalog.widgets.size === 0 && errors.length === 0)
    errors.push({
      file: DIAGNOSTIC_FILE,
      message:
        'No library of the project declares an HMI widget. The standard widgets ship with the editor: reinstall it, or ' +
        'run the HMI widgets setup in a development checkout.',
    })
  return { libraries, catalog, errors, warnings, skipped }
}

/** An error about an undefined type, naming the left-out library that declares it when there is one. */
export function withSkippedLibraryCause(message: string, skipped: readonly SkippedWidgetLibrary[]): string {
  const type = /Undefined type '([A-Za-z_][A-Za-z0-9_]*)'/.exec(message)?.[1]?.toUpperCase()
  const library = type === undefined ? undefined : skipped.find((s) => s.names.includes(type))
  if (!library) return message
  return (
    `${message} (the library "${library.name}" declares it but is left out of HMI builds: it is built for ` +
    `HMI core API ${library.required}, but this editor provides HMI core API ${library.provided})`
  )
}

/** Names of the libraries that declare at least one widget of `catalog`. */
export function widgetLibraryNames(catalog: HmiWidgetCatalog): Set<string> {
  return new Set([...catalog.widgets.values()].map((w) => w.library))
}

/** `catalog` with the widgets of `extra` whose names it does not have yet. */
export function withWidgets(catalog: HmiWidgetCatalog, extra: ReadonlyMap<string, HmiWidgetInfo>): HmiWidgetCatalog {
  const widgets = new Map(catalog.widgets)
  for (const [key, widget] of extra) if (!widgets.has(key)) widgets.set(key, widget)
  return { widgets, colors: catalog.colors }
}
