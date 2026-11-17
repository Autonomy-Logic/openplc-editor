/**
 * The `hmi/` folder of a Runtime v4 upload (`docs/HMI.md` in openplc-runtime): the generated unit with the HMI core
 * and its font table under `src/`, the browser client under `client/` with the WebAssembly module that draws its
 * display lists, and `manifest.json`. A project without screens gets the manifest that removes a device's HMI.
 */
import type { HmiBuildSources, HmiDiagnostic } from '../../../../middleware/shared/ports/hmi-preview-types'
import type {
  WasmCompileRequest,
  WasmCompileResult,
  WasmToolchainFiles,
} from '../../../../middleware/shared/ports/wasm-toolchain-types'
import { hmiFontTableFromSources } from '../fonts/font-table-source'
import { generateHmiUnit, type HmiTag } from '../unit/generate-hmi-unit'
import { type HmiProgramInstance, hmiTagResolver } from './tag-resolver'

type StlibArchive = NonNullable<Parameters<typeof generateHmiUnit>[0]['plcArchives']>[number]

/** Files of the artefact by path in the upload (`hmi/...`). */
export type HmiArtefactFiles = Record<string, string | Uint8Array>

export interface ComposeHmiArtefactInput {
  /** The project's HMI; null when it has no screens. */
  sources: HmiBuildSources | null
  /** The PLC libraries the program was compiled with. */
  plcArchives: readonly StlibArchive[]
  /** The program's debug-map.json. */
  debugMapJson: string
  /** The program's MD5, as the runtime reports it to the HMI. */
  md5: string
  instances: readonly HmiProgramInstance[]
  /** Every file under the HMI sources folder (`core/`, `unit/`, `client/`, `fonts/`), text or bytes. */
  hmiSources: Readonly<Record<string, string | Uint8Array>>
  /** Compiles the client's WebAssembly module. */
  compile: (request: WasmCompileRequest) => Promise<WasmCompileResult>
}

export type ComposeHmiArtefactResult =
  | { ok: true; files: HmiArtefactFiles; tags: HmiTag[]; warnings: HmiDiagnostic[] }
  | { ok: false; errors: HmiDiagnostic[]; warnings: HmiDiagnostic[] }

const ROOT = 'hmi'
const UNIT = 'HMI'
export const HMI_INSTALL_MANIFEST = '{"format": 1}\n'
export const HMI_REMOVE_MANIFEST = '{"format": 1, "remove": true}\n'
/** Client files shipped as they are, from `client/` of the HMI sources. */
const CLIENT_FILES = ['index.html', 'hmi.css', 'hmi-client.js', 'socket.io.min.js', 'socket.io-LICENSE.txt']
const CLIENT_HOST = 'client/hmi_client.c'
const FONTS_LICENSE = 'fonts/LICENSE.txt'
/** Core files the client module draws with. */
const CLIENT_CORE_SOURCES = ['hmi_raster.c', 'hmi_text.c', 'hmi_math.c']
const CLIENT_MAX_MEMORY = 512 * 1024 * 1024
export const HMI_CLIENT_C_FLAGS = ['-std=c11', '-O2', '-ffp-contract=off', '-Icore']
export const HMI_CLIENT_LINK_FLAGS = ['-mexec-model=reactor', `-Wl,--max-memory=${CLIENT_MAX_MEMORY}`]

const decoder = new TextDecoder()
const text = (content: string | Uint8Array): string => (typeof content === 'string' ? content : decoder.decode(content))

/** The removal artefact: only a manifest that tells the runtime to drop its HMI. */
export function hmiRemovalArtefact(): HmiArtefactFiles {
  return { [`${ROOT}/manifest.json`]: HMI_REMOVE_MANIFEST }
}

/** Builds the artefact of a project with screens. */
export async function composeHmiArtefact(input: ComposeHmiArtefactInput): Promise<ComposeHmiArtefactResult> {
  if (!input.sources) return { ok: true, files: hmiRemovalArtefact(), tags: [], warnings: [] }
  const fail = (message: string, warnings: HmiDiagnostic[] = []): ComposeHmiArtefactResult => ({
    ok: false,
    errors: [{ file: UNIT, message }],
    warnings,
  })
  const source = (path: string): string | Uint8Array | undefined => input.hmiSources[path]

  const unit = generateHmiUnit({
    ...input.sources,
    plcArchives: input.plcArchives,
    resolve: hmiTagResolver(input.debugMapJson, input.instances),
    plcMd5: input.md5,
  })
  if (!unit.ok) return { ok: false, errors: unit.errors, warnings: unit.warnings }

  let fontTable: string
  try {
    fontTable = await hmiFontTableFromSources(unit.fonts.faces, unit.fonts.variant, input.hmiSources)
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), unit.warnings)
  }

  const files: HmiArtefactFiles = { [`${ROOT}/manifest.json`]: HMI_INSTALL_MANIFEST }
  for (const [name, content] of Object.entries(unit.files)) files[`${ROOT}/src/${name}`] = content
  files[`${ROOT}/src/hmi_fonts.c`] = fontTable
  const unitHeader = source('unit/hmi_unit.h')
  if (unitHeader === undefined) return fail('The HMI sources have no unit/hmi_unit.h', unit.warnings)
  files[`${ROOT}/src/hmi_unit.h`] = text(unitHeader)
  const coreFiles = Object.entries(input.hmiSources).filter(([path]) => /^core\/.*\.[ch]$/.test(path))
  if (coreFiles.length === 0) return fail('The HMI sources have no core/', unit.warnings)
  for (const [path, content] of coreFiles) files[`${ROOT}/src/${path}`] = text(content)

  for (const name of CLIENT_FILES) {
    const content = source(`client/${name}`)
    if (content === undefined) return fail(`The HMI sources have no client/${name}`, unit.warnings)
    files[`${ROOT}/client/${name}`] = text(content)
  }
  const fontsLicense = source(FONTS_LICENSE)
  if (fontsLicense === undefined) return fail(`The HMI sources have no ${FONTS_LICENSE}`, unit.warnings)
  files[`${ROOT}/client/fonts-LICENSE.txt`] = text(fontsLicense)

  const host = source(CLIENT_HOST)
  if (host === undefined) return fail(`The HMI sources have no ${CLIENT_HOST}`, unit.warnings)
  const wasmFiles: WasmToolchainFiles = { 'client/hmi_client.c': text(host), 'client/hmi_fonts.c': fontTable }
  for (const [path, content] of coreFiles) wasmFiles[path] = text(content)
  const compiled = await input.compile({
    files: wasmFiles,
    units: [
      ...CLIENT_CORE_SOURCES.map((name) => ({ source: `core/${name}`, language: 'c' as const })),
      { source: 'client/hmi_fonts.c', language: 'c' },
      { source: 'client/hmi_client.c', language: 'c' },
    ],
    cFlags: HMI_CLIENT_C_FLAGS,
    linkFlags: HMI_CLIENT_LINK_FLAGS,
    output: 'hmi_client.wasm',
  })
  if (!compiled.ok) {
    const details = compiled.diagnostics.filter((d) => d.level === 'error').map((d) => d.message)
    return fail(
      `The HMI browser client did not compile: ${details.length > 0 ? details.join('\n') : compiled.error}`,
      unit.warnings,
    )
  }
  files[`${ROOT}/client/hmi_client.wasm`] = compiled.wasm
  return { ok: true, files, tags: unit.tags, warnings: unit.warnings }
}
