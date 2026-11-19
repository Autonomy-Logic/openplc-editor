/**
 * The HMI step of a Runtime v4 build: the `hmi/` folder the upload carries. A project with screens gets its built
 * HMI; one without gets the manifest that removes a device's HMI, sent only to a runtime that accepts `hmi/`.
 */
import type { StlibArchive } from 'strucpp'

import type { CompilerPlatformPort, PlatformLog } from '../../../../middleware/shared/ports/compiler-platform-port'
import type { HmiBuildSources } from '../../../../middleware/shared/ports/hmi-preview-types'
import { composeHmiArtefact, type HmiArtefactFiles, hmiRemovalArtefact } from '../../hmi/artefact/compose-hmi-artefact'
import type { HmiProgramInstance } from '../../hmi/artefact/tag-resolver'

export interface HmiArtefactStepInput {
  hmi: HmiBuildSources | null
  /** Whether the target runtime accepts `hmi/`; null when no runtime was asked (a build without upload). */
  runtimeSupportsHmi: boolean | null
  libraryArchives: readonly unknown[]
  debugMapJson: string
  md5: string
  instances: readonly HmiProgramInstance[]
  /** STruC++ runtime headers keyed `strucpp_runtime/include/<file>`, which the browser module compiles against. */
  runtimeHeaders: Readonly<Record<string, string>>
  port: Pick<CompilerPlatformPort, 'readHmiSources' | 'compileWasmModule'>
  log: PlatformLog
}

export type HmiArtefactStepResult = { ok: true; files: HmiArtefactFiles } | { ok: false }

/** Whether a loaded library archive is a STruC++ `.stlib` archive. */
export const isStlibArchive = (value: unknown): value is StlibArchive =>
  typeof value === 'object' &&
  value !== null &&
  'manifest' in value &&
  typeof value.manifest === 'object' &&
  value.manifest !== null &&
  'name' in value.manifest &&
  typeof value.manifest.name === 'string'

export async function buildHmiArtefactStep(input: HmiArtefactStepInput): Promise<HmiArtefactStepResult> {
  if (!input.hmi) {
    if (input.runtimeSupportsHmi !== true) return { ok: true, files: {} }
    input.log('No HMI screens: the upload removes the HMI from the device', 'info')
    return { ok: true, files: hmiRemovalArtefact() }
  }
  input.log(`Building the HMI (${input.hmi.screens.length} screen(s))...`, 'info')
  const result = await composeHmiArtefact({
    sources: input.hmi,
    plcArchives: input.libraryArchives.filter(isStlibArchive),
    debugMapJson: input.debugMapJson,
    md5: input.md5,
    instances: input.instances,
    hmiSources: await input.port.readHmiSources(),
    runtimeHeaders: input.runtimeHeaders,
    compile: (request) => input.port.compileWasmModule(request, input.log),
  })
  const where = (d: { file: string; line?: number }) => (d.line === undefined ? d.file : `${d.file}:${d.line}`)
  for (const w of result.warnings) input.log(`${where(w)}: ${w.message}`, 'warning')
  if (!result.ok) {
    for (const e of result.errors) input.log(`${where(e)}: ${e.message}`, 'error')
    return { ok: false }
  }
  input.log(
    `HMI built: ${result.pages.length} screen(s) for the browser, ${result.tags.length} PLC variable(s) served by the device`,
    'info',
  )
  return { ok: true, files: result.files }
}

/** Why a project with screens cannot go to a runtime that does not accept `hmi/`. */
export const HMI_UNSUPPORTED_RUNTIME =
  'This project has HMI screens, but the runtime on this device does not support them. ' +
  'Update the runtime to upload this project, or remove the screens.'

/** Why a project with screens cannot be built for a board with no local panel. */
export const hmiNoPanelMessage = (board: string): string =>
  `The board "${board}" has no display, so it cannot run the project's HMI screens. ` +
  'Remove the screens or choose a board with a panel.'
