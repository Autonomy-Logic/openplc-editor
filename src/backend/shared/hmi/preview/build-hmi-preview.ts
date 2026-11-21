/**
 * The editor's preview build: generates the HMI unit and its WebAssembly compile request, one unit per group of
 * generated files with the core, fonts and widget libraries apart, so an edit rebuilds only what it changed.
 */
import type {
  HmiBuildStep,
  HmiPreviewBuild,
  HmiPreviewRequest,
  HmiPreviewTimings,
} from '../../../../middleware/shared/ports/hmi-preview-types'
import type {
  WasmCompileRequest,
  WasmCompileResult,
  WasmCompileUnit,
} from '../../../../middleware/shared/ports/wasm-toolchain-types'
import { withoutLibraryFiles } from '../../library/library-unit'
import { buildHmiFontTableSource, HmiFontError } from '../fonts/font-table-source'
import { vettedHmiFont } from '../fonts/vetted-fonts'
import {
  HMI_LIBRARY_CXX_FLAGS,
  type HmiLibraryUnit,
  hmiLibraryUnits,
  sharedWidgetLibraries,
} from '../lib-object/library-unit'
import {
  generateHmiUnit,
  HMI_GALLERY_SCREEN,
  HMI_THEME_PREVIEW_SCREEN,
  type HmiPreview,
  WIDGET_PREVIEW_SCREEN,
} from '../unit/generate-hmi-unit'
import {
  HMI_PRELUDE_PCH,
  HMI_PRELUDE_SOURCE,
  HMI_UNIT_LIBRARIES_HEADER,
  type HmiPrelude,
  hmiPreludeFits,
} from './hmi-prelude'
import { splitScreenHeaders } from './split-screen-headers'

/** What the preview build reads besides the project: the files every preview compiles in. */
export interface HmiPreviewResources {
  /** STruC++ runtime headers (`iec_*.hpp`, ...) by file name. */
  runtimeHeaders: Readonly<Record<string, string>>
  /** The HMI C sources by path under the HMI sources folder: `core/...`, `unit/...` and `preview/...`. */
  hmiSources: Readonly<Record<string, string>>
  /** A vetted font file by name. */
  readFont: (file: string) => Promise<Uint8Array>
  /** The archives of the libraries the project uses (bundled and listed), verbatim; the preview compiles against them. */
  projectLibraries: readonly unknown[]
  /** The shipped precompiled prelude, when there is one for these files and this toolchain. */
  prelude?: HmiPrelude | null
}

/** Compiles a request; the platform's WebAssembly toolchain. */
export type HmiPreviewCompile = (request: WasmCompileRequest) => Promise<WasmCompileResult>

const HMI_DIR = 'hmi'
const UNIT_DIR = 'unit'
const RUNTIME_DIR = 'strucpp_runtime/include'
/** Wrappers live beside the unit files' folder and include them through `-Iunit`. */
const GROUP_DIR = 'groups'
const FONT_TABLE = `${UNIT_DIR}/hmi_preview_fonts.c`
/** The unit's libraries header, which declares every library the unit links. */
const LIBRARIES_HEADER = HMI_UNIT_LIBRARIES_HEADER
const HOST = `${HMI_DIR}/preview/hmi_preview_host.cpp`
/** The live elements' code, compiled against the widget library that provides the screen base. */
const LIVE_SOURCE = `${HMI_DIR}/preview/hmi_preview_live.cpp`
/** The header the live elements' code includes for the widget declarations it uses. */
const LIVE_WIDGETS = 'hmi_preview_widgets.hpp'
const FACTORY_GROUP = 'groups/factory.cpp'
const CORE_SOURCES = ['hmi_core.c', 'hmi_theme.c', 'hmi_math.c', 'hmi_raster.c', 'hmi_text.c']
/** Upper bound of the module's memory: a 2560 x 1600 surface at density 2 and the unit fit with room to spare. */
export const HMI_PREVIEW_MAX_MEMORY = 128 * 1024 * 1024
const STACK_SIZE = 1024 * 1024

const INCLUDES = [`-I${RUNTIME_DIR}`, `-I${HMI_DIR}/core`, `-I${HMI_DIR}/unit`, `-I${UNIT_DIR}`]
/** Bounds records a preview frame keeps: design mode adds ports, diagram frames and pipe points. */
export const HMI_PREVIEW_BOUNDS_MAX = 4096
/** C flags of the core: the ones its golden tests use, so the preview draws the same pixels. */
export const HMI_PREVIEW_C_FLAGS = [
  '-std=c11',
  '-O2',
  '-ffp-contract=off',
  `-DHMI_BOUNDS_MAX=${HMI_PREVIEW_BOUNDS_MAX}`,
  ...INCLUDES,
]
/** C++ flags of the unit and host: optimised for build time, as the preview rebuilds on request. */
export const HMI_PREVIEW_CXX_FLAGS = [
  '-std=gnu++17',
  '-O1',
  '-fno-exceptions',
  '-fno-rtti',
  '-ffp-contract=off',
  ...INCLUDES,
]
export const HMI_PREVIEW_LINK_FLAGS = [
  '-mexec-model=reactor',
  `-Wl,--max-memory=${HMI_PREVIEW_MAX_MEMORY}`,
  `-Wl,-z,stack-size=${STACK_SIZE}`,
]

/** Wrapper sources compiling each group of unit files as one translation unit, keyed by their path. */
function groupUnits(groups: HmiPreview['units']): Record<string, string> {
  const named: Array<[string, readonly string[]]> = [
    ['library', groups.library],
    ['widgets', groups.widgets],
    ...Object.entries(groups.screens).map(([screen, files]): [string, readonly string[]] => [
      `screen_${screen}`,
      files,
    ]),
    ['glue', groups.glue],
  ]
  const wrappers: Record<string, string> = {}
  for (const [name, files] of named) {
    if (files.length === 0) continue
    wrappers[`${GROUP_DIR}/${name}.cpp`] = `${files.map((f) => `#include "${f}"`).join('\n')}\n`
  }
  wrappers[FACTORY_GROUP] = groups.factory.map((f) => `#include "${f}"\n`).join('')
  return wrappers
}

/** Folders of the HMI sources folder whose files the preview compiles with. */
const PREVIEW_SOURCE = /^(core|unit|preview)\/.*\.(c|h|cpp|hpp)$/

/** Whether a path under the HMI sources folder is one of the sources every preview request carries. */
export const isHmiPreviewSource = (path: string): boolean => PREVIEW_SOURCE.test(path)

/** The files every preview request carries by request path: the runtime headers and the HMI sources. */
export function hmiPreviewFixedFiles(
  resources: Pick<HmiPreviewResources, 'runtimeHeaders' | 'hmiSources'>,
): Record<string, string> {
  const files: Record<string, string> = {}
  for (const [name, text] of Object.entries(resources.runtimeHeaders)) files[`${RUNTIME_DIR}/${name}`] = text
  for (const [path, text] of Object.entries(resources.hmiSources)) files[`${HMI_DIR}/${path}`] = text
  return files
}

/**
 * The compile request of a generated unit: its files and setters under `unit/`, one wrapper per group of files that
 * change together, the HMI sources under `hmi/`, the runtime headers and the font table. With a prelude that fits the
 * unit, every group but the factory starts from its precompiled header.
 */
export function buildHmiPreviewRequest(
  unitFiles: Readonly<Record<string, string>>,
  groups: HmiPreview['units'],
  fontTable: string,
  resources: Pick<HmiPreviewResources, 'runtimeHeaders' | 'hmiSources' | 'prelude'>,
  libraries: readonly HmiLibraryUnit[] = [],
): WasmCompileRequest {
  const files: WasmCompileRequest['files'] = {}
  for (const library of libraries) Object.assign(files, library.files)
  Object.assign(files, hmiPreviewFixedFiles(resources))
  for (const [name, text] of Object.entries(unitFiles)) files[`${UNIT_DIR}/${name}`] = text
  files[FONT_TABLE] = fontTable
  const shipped = resources.prelude
  const prelude = hmiPreludeFits(shipped, unitFiles) ? shipped : null
  if (prelude) {
    files[HMI_PRELUDE_SOURCE] = prelude.header
    files[HMI_PRELUDE_PCH] = prelude.pch
  }
  const wrappers = groupUnits(groups)
  Object.assign(files, wrappers)
  const base = libraries.find((library) => library.screenBase !== null)?.screenBase
  if (!base) files[`${UNIT_DIR}/${LIVE_WIDGETS}`] = `#include "${LIBRARIES_HEADER}"\n`
  const units: WasmCompileUnit[] = [
    ...CORE_SOURCES.map((name): WasmCompileUnit => ({ source: `${HMI_DIR}/core/${name}`, language: 'c' })),
    { source: FONT_TABLE, language: 'c' },
    ...Object.keys(wrappers).map(
      (source): WasmCompileUnit =>
        prelude && source !== FACTORY_GROUP
          ? { source, language: 'c++', flags: ['-include-pch', HMI_PRELUDE_PCH] }
          : { source, language: 'c++' },
    ),
    { source: HOST, language: 'c++' },
    base
      ? {
          source: LIVE_SOURCE,
          language: 'c++',
          flags: [...HMI_LIBRARY_CXX_FLAGS, `-I${HMI_DIR}/unit`, `-I${base.dir}`],
          ownFlags: true,
        }
      : { source: LIVE_SOURCE, language: 'c++' },
    ...libraries.flatMap((library) => [library.unit, library.factory.unit]),
  ]
  return {
    files,
    units,
    cFlags: HMI_PREVIEW_C_FLAGS,
    cxxFlags: HMI_PREVIEW_CXX_FLAGS,
    linkFlags: HMI_PREVIEW_LINK_FLAGS,
    output: 'hmi_preview.wasm',
  }
}

const UNIT = 'HMI'

/** Resolves on a later task, so a step reported before synchronous work can be drawn first. */
const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** Builds the preview of a project's screens, of one widget block when `input.widgetPreview` names it, or the gallery. */
export async function buildHmiPreview(
  input: HmiPreviewRequest,
  resources: HmiPreviewResources,
  compile: HmiPreviewCompile,
  onStep?: (step: HmiBuildStep) => void,
): Promise<HmiPreviewBuild> {
  const started = performance.now()
  const timings: HmiPreviewTimings = {
    sourcesMs: 0,
    generateMs: 0,
    widgetsMs: 0,
    strucppMs: 0,
    fontsMs: 0,
    toolchainMs: 0,
    totalMs: 0,
  }
  const done = (): HmiPreviewTimings => ({ ...timings, totalMs: performance.now() - started })
  onStep?.('generate')
  await nextTask()
  const generateStart = performance.now()
  const widgetLibraries = sharedWidgetLibraries(resources.projectLibraries)
  const libraryUnits = await hmiLibraryUnits(widgetLibraries.shared, widgetLibraries.all)
  if (!libraryUnits.ok)
    return { ok: false, errors: [{ file: UNIT, message: libraryUnits.error }], warnings: [], timings: done() }
  const generated = generateHmiUnit({
    ...input,
    projectLibraries: resources.projectLibraries,
    libraryFactories: libraryUnits.units.map((u) => u.factory.table),
    preview: true,
    resolve: undefined,
    plcMd5: undefined,
  })
  timings.generateMs = performance.now() - generateStart
  timings.widgetsMs = generated.timings.widgetsMs
  timings.strucppMs = generated.timings.strucppMs
  if (!generated.ok) return { ok: false, errors: generated.errors, warnings: generated.warnings, timings: done() }

  const fontsStart = performance.now()
  let fontTable: string
  try {
    const fonts = await Promise.all(
      generated.fonts.faces.map(async (id) => {
        const vetted = vettedHmiFont(id, generated.fonts.variant)
        if (!vetted) throw new HmiFontError(`Font id ${id} (${generated.fonts.variant}) is not a bundled HMI font`)
        return { id, variant: generated.fonts.variant, bytes: await resources.readFont(vetted.file) }
      }),
    )
    fontTable = await buildHmiFontTableSource(fonts)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, errors: [{ file: UNIT, message }], warnings: generated.warnings, timings: done() }
  }
  timings.fontsMs = performance.now() - fontsStart

  const unitFiles = withoutLibraryFiles(
    { ...generated.files, ...generated.preview.files },
    new Set(libraryUnits.units.map((u) => u.name)),
  )
  const groups = {
    ...generated.preview.units,
    library: generated.preview.units.library.filter((f) => f in unitFiles),
  }
  const request = buildHmiPreviewRequest(
    splitScreenHeaders(unitFiles, groups.screens),
    groups,
    fontTable,
    resources,
    libraryUnits.units,
  )
  onStep?.('compile')
  const toolchainStart = performance.now()
  const result = await compile(request)
  timings.toolchainMs = performance.now() - toolchainStart
  if (!result.ok) {
    const errors = result.diagnostics
      .filter((d) => d.level === 'error')
      .map((d) => ({ file: UNIT, message: d.message }))
    return {
      ok: false,
      errors: errors.length > 0 ? errors : [{ file: UNIT, message: result.error }],
      warnings: generated.warnings,
      stats: result.stats,
      timings: done(),
    }
  }
  const names = input.gallery
    ? [HMI_GALLERY_SCREEN]
    : input.themePreview !== undefined
      ? [HMI_THEME_PREVIEW_SCREEN]
      : [...input.screens.map((s) => s.name), ...(input.widgetPreview === undefined ? [] : [WIDGET_PREVIEW_SCREEN])]
  return {
    ok: true,
    wasm: result.wasm,
    pages: Object.fromEntries(names.map((name, page) => [name, page])),
    setters: generated.preview.setters,
    elementIds: generated.elementIds,
    factory: generated.preview.factory,
    warnings: generated.warnings,
    stats: result.stats,
    timings: done(),
  }
}
