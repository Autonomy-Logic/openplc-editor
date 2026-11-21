/**
 * The HMI preview port every platform uses: reads the preview's resources once through the platform's mechanisms,
 * builds with its toolchain and runs modules in its Workers.
 */
import type {
  HmiPreviewMechanisms,
  HmiPreviewStoredFiles,
} from '../../../../middleware/shared/ports/hmi-preview-mechanisms'
import type { HmiPreviewPort } from '../../../../middleware/shared/ports/hmi-preview-port'
import type {
  HmiPreviewRequest,
  HmiSourceFile,
  HmiThumbnailResult,
} from '../../../../middleware/shared/ports/hmi-preview-types'
import { selectProjectLibraryArchives } from '../../../../middleware/shared/utils/library/project-libraries'
import { WASM_TOOLCHAIN_IDENTITY } from '../../wasm-toolchain/toolchain-identity'
import { loadHmiWidgetLibraries } from '../lib/widget-libraries'
import {
  buildHmiWidgetCatalog,
  hmiGlueSource,
  hmiScreenMembers,
  type HmiWidgetLibrary,
} from '../unit/generate-hmi-unit'
import {
  buildHmiPreview,
  hmiPreviewFixedFiles,
  type HmiPreviewResources,
  isHmiPreviewSource,
} from './build-hmi-preview'
import { HMI_PRELUDE_FILE, HMI_PRELUDE_INDEX, loadHmiPrelude } from './hmi-prelude'
import { renderHmiThumbnails } from './hmi-thumbnails'
import { createHmiPreviewSession, type HmiPreviewSessionOptions } from './preview-session'

const FONTS = 'fonts/'

const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/**
 * The compiled-in sources as text (`isHmiPreviewSource`) and the font files as bytes, out of the HMI sources folder's
 * files, and the runtime headers by file name.
 */
export function hmiPreviewResources(
  stored: HmiPreviewStoredFiles,
  storedHeaders: Readonly<Record<string, string>>,
): Omit<HmiPreviewResources, 'projectLibraries'> {
  const hmiFiles: Record<string, string | Uint8Array> = {}
  for (const [path, content] of Object.entries(stored.files)) {
    if (path.startsWith(stored.root)) hmiFiles[path.slice(stored.root.length)] = content
  }
  const runtimeHeaders: Record<string, string> = {}
  for (const [path, content] of Object.entries(storedHeaders)) runtimeHeaders[fileName(path)] = content
  const hmiSources: Record<string, string> = {}
  const decoder = new TextDecoder()
  for (const [path, content] of Object.entries(hmiFiles)) {
    if (!isHmiPreviewSource(path)) continue
    hmiSources[path] = typeof content === 'string' ? content : decoder.decode(content)
  }
  return {
    runtimeHeaders,
    hmiSources,
    readFont: (file) => {
      const bytes = hmiFiles[`${FONTS}${file}`]
      return bytes instanceof Uint8Array
        ? Promise.resolve(bytes)
        : Promise.reject(new Error(`The HMI font ${file} is not available`))
    },
  }
}

/** Who holds the toolchain while an HMI editor is open. */
export const HMI_TOOLCHAIN_HOLDER = 'hmi-editor'

export function createHmiPreviewPort(
  mechanisms: HmiPreviewMechanisms,
  sessionOptions: HmiPreviewSessionOptions = {},
): HmiPreviewPort {
  let resources: Promise<Omit<HmiPreviewResources, 'projectLibraries'>> | null = null
  let libraries: Promise<readonly unknown[]> | null = null
  let librariesVersion = 0
  let catalogCache: { key: string; result: HmiWidgetLibrary } | null = null
  let thumbnailCache: { key: string; result: Promise<HmiThumbnailResult> } | null = null
  mechanisms.onLibrariesChanged(() => {
    libraries = null
    librariesVersion += 1
  })
  const loadInstalled = (): Promise<readonly unknown[]> => {
    const loading = libraries ?? mechanisms.loadLibraries()
    libraries = loading
    loading.catch(() => {
      if (libraries === loading) libraries = null
    })
    return loading
  }
  /** The installed archives of the libraries named in `names`, the ones the project uses. */
  const loadLibraries = async (names: readonly string[]): Promise<unknown[]> =>
    selectProjectLibraryArchives(await loadInstalled(), names)
  const catalogOf = (
    widgets: readonly HmiSourceFile[],
    names: readonly string[],
    selected: readonly unknown[],
  ): HmiWidgetLibrary => {
    const key = [
      librariesVersion,
      names.join('\u0000'),
      widgets.map((w) => `${w.name}\u0000${w.source}`).join('\u0001'),
    ].join('\u0002')
    if (catalogCache?.key !== key) catalogCache = { key, result: buildHmiWidgetCatalog(widgets, selected) }
    return catalogCache.result
  }
  /** A shipped file, or null when it cannot be read: the prelude is optional. */
  const readShipped = (name: string): Promise<Uint8Array | null> => mechanisms.readShippedFile(name).catch(() => null)
  const loadResources = (): Promise<Omit<HmiPreviewResources, 'projectLibraries'>> => {
    resources ??= Promise.all([
      mechanisms.readHmiSources(),
      mechanisms.readStrucppRuntimeHeaders(),
      readShipped(HMI_PRELUDE_INDEX),
      readShipped(HMI_PRELUDE_FILE),
    ]).then(async ([hmiFiles, runtimeHeaders, preludeIndex, preludePch]) => {
      const files = hmiPreviewResources(hmiFiles, runtimeHeaders)
      const fixed = hmiPreviewFixedFiles(files)
      const prelude = await loadHmiPrelude(preludeIndex, preludePch, WASM_TOOLCHAIN_IDENTITY, fixed).catch(() => null)
      return { ...files, prelude }
    })
    resources.catch(() => {
      resources = null
    })
    return resources
  }
  const build = (request: HmiPreviewRequest) => port.build(request)
  const openSession = () => port.openSession()
  const port: HmiPreviewPort = {
    async build(request, onStep) {
      onStep?.('sources')
      const sourcesStart = performance.now()
      let loaded: HmiPreviewResources
      try {
        const [files, projectLibraries] = await Promise.all([loadResources(), loadLibraries(request.libraries)])
        loaded = { ...files, projectLibraries }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          ok: false,
          errors: [{ file: 'HMI', message: `The preview's files could not be read: ${message}` }],
          warnings: [],
        }
      }
      const sourcesMs = performance.now() - sourcesStart
      const built = await buildHmiPreview(
        request,
        loaded,
        (compileRequest) => mechanisms.compileToWasm(compileRequest),
        onStep,
      )
      if (!built.timings) return built
      return {
        ...built,
        timings: { ...built.timings, sourcesMs, totalMs: built.timings.totalMs + sourcesMs },
      }
    },
    async codeContext(sources) {
      const { libraries: loaded } = loadHmiWidgetLibraries(await loadLibraries(sources.libraries))
      return {
        libraries: loaded.map((l) => ({ name: l.name, archiveJson: l.archiveJson })),
        glue: hmiGlueSource(
          sources.screens.map((s) => s.name),
          sources.settings,
        ),
        screenMembers: [...new Set(loaded.flatMap((l) => [...hmiScreenMembers(l.archive)]))],
      }
    },
    async catalog(widgets, names) {
      const library = catalogOf(widgets, names, await loadLibraries(names))
      return { catalog: library.catalog, errors: library.errors }
    },
    async thumbnails(sources, scale) {
      const selected = await loadLibraries(sources.libraries)
      const key = JSON.stringify([
        librariesVersion,
        sources.libraries,
        sources.widgets,
        sources.settings,
        sources.projectNames,
        scale,
      ])
      if (thumbnailCache?.key !== key) {
        const result =
          catalogOf(sources.widgets, sources.libraries, selected).errors.length > 0
            ? renderHmiThumbnails({ ...sources, widgets: [] }, scale, build, openSession)
            : renderHmiThumbnails(sources, scale, build, openSession)
        thumbnailCache = { key, result }
        const forget = () => {
          if (thumbnailCache?.result === result) thumbnailCache = null
        }
        void result.then((r) => {
          if (r.errors.length > 0) forget()
        }, forget)
      }
      return thumbnailCache.result
    },
    openSession: () => createHmiPreviewSession(() => mechanisms.startWorker(), sessionOptions),
    holdToolchain: (held) => mechanisms.holdToolchain(HMI_TOOLCHAIN_HOLDER, held),
  }
  return port
}
