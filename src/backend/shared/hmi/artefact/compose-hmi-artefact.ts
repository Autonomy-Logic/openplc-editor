/**
 * The `hmi/` folder of a Runtime v4 upload (`docs/HMI.md` in openplc-runtime). The browser runs the screens: the
 * client under `client/` carries `hmi.wasm`, the whole HMI (generated unit, HMI core, font table and the browser host)
 * built as WebAssembly. The device only serves PLC values: `src/` holds the host-side manifest (`hmi_access.h` and the
 * generated `hmi_access.c`) with the tag table and the tags each screen reads and writes. A project without screens
 * gets the manifest that removes a device's HMI.
 */
import type { HmiBuildSources, HmiDiagnostic } from '../../../../middleware/shared/ports/hmi-preview-types'
import type {
  WasmCompileRequest,
  WasmCompileResult,
  WasmCompileUnit,
} from '../../../../middleware/shared/ports/wasm-toolchain-types'
import { hmiFontTableFromSources } from '../fonts/font-table-source'
import { type HmiLibraryUnit, sharedWidgetLibraries, shareLibraryUnits } from '../lib-object/library-unit'
import { generateHmiUnit, type HmiPageTags, type HmiTag } from '../unit/generate-hmi-unit'
import { hmiHostManifestSource } from './host-manifest'
import { type HmiProgramInstance, hmiTagResolver } from './tag-resolver'

/** Files of the artefact by path in the upload (`hmi/...`). */
export type HmiArtefactFiles = Record<string, string | Uint8Array>

export interface ComposeHmiArtefactInput {
  /** The project's HMI; null when it has no screens. */
  sources: HmiBuildSources | null
  /** The build's library archives, verbatim: the PLC libraries the program was compiled with and the widget libraries. */
  libraries: readonly unknown[]
  /** The target's capabilities; widgets that need one it lacks are refused. */
  capabilities: object
  /** The program's debug-map.json. */
  debugMapJson: string
  /** The program's MD5, as the runtime reports it to the HMI. */
  md5: string
  instances: readonly HmiProgramInstance[]
  /** Every file under the HMI sources folder (`core/`, `unit/`, `client/`, `fonts/`), text or bytes. */
  hmiSources: Readonly<Record<string, string | Uint8Array>>
  /** STruC++ runtime headers by path, `strucpp_runtime/include/<file>`, as the program build has them. */
  runtimeHeaders: Readonly<Record<string, string>>
  /** Compiles the client's WebAssembly module. */
  compile: (request: WasmCompileRequest) => Promise<WasmCompileResult>
}

export type ComposeHmiArtefactResult =
  | { ok: true; files: HmiArtefactFiles; tags: HmiTag[]; pages: HmiPageTags[]; warnings: HmiDiagnostic[] }
  | { ok: false; errors: HmiDiagnostic[]; warnings: HmiDiagnostic[] }

const ROOT = 'hmi'
const UNIT = 'HMI'
export const HMI_INSTALL_MANIFEST = '{"format": 2}\n'
export const HMI_REMOVE_MANIFEST = '{"format": 2, "remove": true}\n'
/** Client files shipped as they are, from `client/` of the HMI sources. */
const CLIENT_FILES = ['index.html', 'hmi.css', 'hmi-client.js', 'socket.io.min.js', 'socket.io-LICENSE.txt']
const BROWSER_HOST = 'client/hmi_browser_host.cpp'
const ACCESS_HEADER = 'unit/hmi_access.h'
const UNIT_HEADER = 'unit/hmi_unit.h'
const FONTS_LICENSE = 'fonts/LICENSE.txt'
const CORE_SOURCES = ['hmi_core.c', 'hmi_theme.c', 'hmi_math.c', 'hmi_raster.c', 'hmi_text.c']
/** Where the module's sources sit in the compile request. */
const MODULE_HMI = 'hmi'
const MODULE_UNIT = 'unit'
const MODULE_FONTS = `${MODULE_UNIT}/hmi_fonts.c`
const RUNTIME_INCLUDE = 'strucpp_runtime/include'
export const HMI_CLIENT_MODULE = 'hmi.wasm'
const CLIENT_MAX_MEMORY = 512 * 1024 * 1024
const CLIENT_STACK_SIZE = 1024 * 1024
const INCLUDES = [`-I${RUNTIME_INCLUDE}`, `-I${MODULE_HMI}/core`, `-I${MODULE_HMI}/unit`, `-I${MODULE_UNIT}`]
/** C flags of the core: the ones its golden tests use, so the browser draws the same pixels as every other target. */
export const HMI_CLIENT_C_FLAGS = ['-std=c11', '-O2', '-ffp-contract=off', ...INCLUDES]
export const HMI_CLIENT_CXX_FLAGS = [
  '-std=gnu++17',
  '-O2',
  '-fno-exceptions',
  '-fno-rtti',
  '-ffp-contract=off',
  ...INCLUDES,
]
export const HMI_CLIENT_LINK_FLAGS = [
  '-mexec-model=reactor',
  `-Wl,--max-memory=${CLIENT_MAX_MEMORY}`,
  `-Wl,-z,stack-size=${CLIENT_STACK_SIZE}`,
]

const decoder = new TextDecoder()
const text = (content: string | Uint8Array): string => (typeof content === 'string' ? content : decoder.decode(content))

/** The removal artefact: only a manifest that tells the runtime to drop its HMI. */
export function hmiRemovalArtefact(): HmiArtefactFiles {
  return { [`${ROOT}/manifest.json`]: HMI_REMOVE_MANIFEST }
}

/** The compile request of the browser module: the unit's C++ files, the core, the font table and the browser host. */
export function hmiClientModuleRequest(
  unitFiles: Readonly<Record<string, string>>,
  fontTable: string,
  hmiSources: Readonly<Record<string, string>>,
  runtimeHeaders: Readonly<Record<string, string>>,
  libraries: readonly HmiLibraryUnit[] = [],
): WasmCompileRequest {
  const files: WasmCompileRequest['files'] = {}
  for (const library of libraries) Object.assign(files, library.files)
  for (const [path, content] of Object.entries(runtimeHeaders)) files[path] = content
  for (const [path, content] of Object.entries(hmiSources)) files[`${MODULE_HMI}/${path}`] = content
  for (const [name, content] of Object.entries(unitFiles)) files[`${MODULE_UNIT}/${name}`] = content
  files[MODULE_FONTS] = fontTable
  const units: WasmCompileUnit[] = [
    ...CORE_SOURCES.map((name): WasmCompileUnit => ({ source: `${MODULE_HMI}/core/${name}`, language: 'c' })),
    { source: MODULE_FONTS, language: 'c' },
    ...Object.keys(unitFiles)
      .filter((name) => name.endsWith('.cpp'))
      .sort()
      .map((name): WasmCompileUnit => ({ source: `${MODULE_UNIT}/${name}`, language: 'c++' })),
    { source: `${MODULE_HMI}/${BROWSER_HOST}`, language: 'c++' },
    ...libraries.map((library) => library.unit),
  ]
  return {
    files,
    units,
    cFlags: HMI_CLIENT_C_FLAGS,
    cxxFlags: HMI_CLIENT_CXX_FLAGS,
    linkFlags: HMI_CLIENT_LINK_FLAGS,
    output: HMI_CLIENT_MODULE,
  }
}

/** Builds the artefact of a project with screens. */
export async function composeHmiArtefact(input: ComposeHmiArtefactInput): Promise<ComposeHmiArtefactResult> {
  if (!input.sources) return { ok: true, files: hmiRemovalArtefact(), tags: [], pages: [], warnings: [] }
  const fail = (message: string, warnings: HmiDiagnostic[] = []): ComposeHmiArtefactResult => ({
    ok: false,
    errors: [{ file: UNIT, message }],
    warnings,
  })
  const source = (path: string): string | Uint8Array | undefined => input.hmiSources[path]

  const unit = generateHmiUnit({
    ...input.sources,
    projectLibraries: input.libraries,
    capabilities: input.capabilities,
    resolve: hmiTagResolver(input.debugMapJson, input.instances),
    plcMd5: input.md5,
  })
  if (!unit.ok) return { ok: false, errors: unit.errors, warnings: unit.warnings }

  const manifest = hmiHostManifestSource({
    tags: unit.tags,
    pages: unit.pages,
    md5: input.md5,
    periodMs: input.sources.settings.framePeriodMs,
  })
  if (!manifest.ok) return fail(manifest.error, unit.warnings)

  const moduleSources: Record<string, string> = {}
  for (const [path, content] of Object.entries(input.hmiSources))
    if (/^core\/.*\.[ch]$/.test(path) || path.startsWith('unit/') || path === BROWSER_HOST)
      moduleSources[path] = text(content)
  for (const required of [UNIT_HEADER, ACCESS_HEADER, BROWSER_HOST])
    if (moduleSources[required] === undefined) return fail(`The HMI sources have no ${required}`, unit.warnings)
  if (!Object.keys(moduleSources).some((p) => p.startsWith('core/')))
    return fail('The HMI sources have no core/', unit.warnings)

  let fontTable: string
  try {
    fontTable = await hmiFontTableFromSources(unit.fonts.faces, unit.fonts.variant, input.hmiSources)
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), unit.warnings)
  }

  const files: HmiArtefactFiles = {
    [`${ROOT}/manifest.json`]: HMI_INSTALL_MANIFEST,
    [`${ROOT}/src/hmi_access.h`]: moduleSources[ACCESS_HEADER],
    [`${ROOT}/src/hmi_access.c`]: manifest.source,
  }
  for (const name of CLIENT_FILES) {
    const content = source(`client/${name}`)
    if (content === undefined) return fail(`The HMI sources have no client/${name}`, unit.warnings)
    files[`${ROOT}/client/${name}`] = text(content)
  }
  const fontsLicense = source(FONTS_LICENSE)
  if (fontsLicense === undefined) return fail(`The HMI sources have no ${FONTS_LICENSE}`, unit.warnings)
  files[`${ROOT}/client/fonts-LICENSE.txt`] = text(fontsLicense)

  const widgetLibraries = sharedWidgetLibraries(input.libraries)
  const shared = shareLibraryUnits(unit.files, widgetLibraries.shared, widgetLibraries.all)
  if (!shared.ok) return fail(shared.error, unit.warnings)
  const compiled = await input.compile(
    hmiClientModuleRequest(shared.unitFiles, fontTable, moduleSources, input.runtimeHeaders, shared.units),
  )
  if (!compiled.ok) {
    const details = compiled.diagnostics.filter((d) => d.level === 'error').map((d) => d.message)
    return fail(
      `The HMI browser module did not compile: ${details.length > 0 ? details.join('\n') : compiled.error}`,
      unit.warnings,
    )
  }
  files[`${ROOT}/client/${HMI_CLIENT_MODULE}`] = compiled.wasm
  return { ok: true, files, tags: unit.tags, pages: unit.pages, warnings: unit.warnings }
}
