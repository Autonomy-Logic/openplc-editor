/**
 * The installed widget libraries (archives of kind `hmi`: the pre-installed standard-widgets and any a user
 * installed), loaded for the HMI build with their widget catalogues. Nothing here compiles a library.
 */
import {
  hmiLibraryCatalog,
  libraryArchiveName,
  libraryArchiveProblem,
  libraryKind,
  partitionLibraryArchives,
} from '@root/middleware/shared/utils/hmi/widget-libraries'
import type { StlibArchive } from 'strucpp'

import type {
  HmiDiagnostic,
  HmiWidgetCatalog,
  HmiWidgetInfo,
} from '../../../../middleware/shared/ports/hmi-preview-types'
import { loadStrucpp, type StrucppRuntime } from '../../library/strucpp-runtime'

/** A widget library ready for STruC++, with its catalogue and its archive as JSON. */
export interface HmiWidgetLibraryArchive {
  name: string
  archive: StlibArchive
  archiveJson: string
  catalog: HmiWidgetCatalog
}

export interface HmiWidgetLibrarySet {
  libraries: HmiWidgetLibraryArchive[]
  errors: HmiDiagnostic[]
}

const DIAGNOSTIC_FILE = 'HMI'

/** Loaded libraries by the archive object they came from, so a list loaded once is not parsed again. */
const loadedCache = new WeakMap<object, HmiWidgetLibraryArchive>()

function loadOne(raw: object, strucpp: Pick<StrucppRuntime, 'loadStlibFromString'>): HmiWidgetLibraryArchive {
  const cached = loadedCache.get(raw)
  if (cached) return cached
  const name = libraryArchiveName(raw)
  const catalog = hmiLibraryCatalog(raw)
  if (!catalog) throw new Error(`the widget library "${name}" has no widget catalogue`)
  const archiveJson = JSON.stringify(raw)
  const loaded = { name, archive: strucpp.loadStlibFromString(archiveJson, name), archiveJson, catalog }
  loadedCache.set(raw, loaded)
  return loaded
}

/**
 * The widget libraries among `archives` (any installed archives, verbatim), in their order. A widget library built for
 * another HMI core API, or one that does not load, is left out with an error; so is a second library of the same name.
 */
export function loadHmiWidgetLibraries(
  archives: readonly unknown[],
  strucpp: Pick<StrucppRuntime, 'loadStlibFromString'> = loadStrucpp(),
): HmiWidgetLibrarySet {
  const libraries: HmiWidgetLibraryArchive[] = []
  const errors: HmiDiagnostic[] = []
  const names = new Set<string>()
  for (const raw of archives) {
    if (libraryKind(raw) !== 'hmi' || typeof raw !== 'object' || raw === null) continue
    const name = libraryArchiveName(raw)
    const problem = libraryArchiveProblem(raw)
    if (problem) {
      errors.push({ file: DIAGNOSTIC_FILE, message: problem })
      continue
    }
    if (names.has(name)) continue
    try {
      libraries.push(loadOne(raw, strucpp))
      names.add(name)
    } catch (error) {
      errors.push({
        file: DIAGNOSTIC_FILE,
        message: `The widget library "${name}" could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }
  if (libraries.length === 0 && errors.length === 0)
    errors.push({
      file: DIAGNOSTIC_FILE,
      message:
        'No HMI widget library is installed. The standard widgets ship with the editor: reinstall it, or run ' +
        'the HMI widgets setup in a development checkout.',
    })
  return { libraries, errors }
}

/** Whether a loaded library archive is a STruC++ `.stlib` archive. */
export const isStlibArchive = (value: unknown): value is StlibArchive =>
  typeof value === 'object' &&
  value !== null &&
  'manifest' in value &&
  typeof value.manifest === 'object' &&
  value.manifest !== null &&
  'name' in value.manifest &&
  typeof value.manifest.name === 'string'

/** The PLC libraries (not of kind `hmi`) among a build's library archives. */
export function plcLibraryArchives(libraries: readonly unknown[]): StlibArchive[] {
  return partitionLibraryArchives(libraries).plc.filter(isStlibArchive)
}

/** The catalogue of every widget the libraries declare; a widget name a former library declared wins. */
export function mergeWidgetCatalogs(catalogs: readonly HmiWidgetCatalog[]): HmiWidgetCatalog {
  const widgets = new Map<string, HmiWidgetInfo>()
  let colors: readonly string[] = []
  for (const catalog of catalogs) {
    for (const [key, widget] of catalog.widgets) if (!widgets.has(key)) widgets.set(key, widget)
    if (colors.length === 0) colors = catalog.colors
  }
  return { widgets, colors }
}
