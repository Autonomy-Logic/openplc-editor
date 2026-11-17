/**
 * The HMI files of a baremetal firmware build for a board with a panel: the generated unit, the HMI core, the font
 * table of the faces the build draws, `hmi_config.h` and the baremetal host, flat under the sketch library `src/`, plus
 * the fonts' licence next to the firmware (not compiled, not flashed). Baremetal.ino picks the host up through
 * `__has_include(<hmi_baremetal.h>)`, so a build without these files has no HMI.
 */
import type { HmiBuildSources, HmiDiagnostic } from '../../../../middleware/shared/ports/hmi-preview-types'
import type { ResolvedHmiPanel } from '../../../../middleware/shared/utils/target-capabilities/hmi-panel'
import { type HmiProgramInstance, hmiTagResolver } from '../artefact/tag-resolver'
import { hmiFontTableFromSources } from '../fonts/font-table-source'
import { HMI_FONT_REGULAR } from '../fonts/vetted-fonts'
import { generateHmiUnit, type HmiTag } from '../unit/generate-hmi-unit'
import { hmiConfigHeader } from './hmi-config-header'

type StlibArchive = NonNullable<Parameters<typeof generateHmiUnit>[0]['plcArchives']>[number]

export interface ComposeHmiFirmwareInput {
  sources: HmiBuildSources
  panel: ResolvedHmiPanel
  /** The PLC libraries the program was compiled with. */
  plcArchives: readonly StlibArchive[]
  /** The firmware program's debug-map.json, which gives each tag its debugger address. */
  debugMapJson: string
  md5: string
  instances: readonly HmiProgramInstance[]
  /** Every file under the HMI sources folder (`core/`, `unit/`, `baremetal/`, `fonts/`), text or bytes. */
  hmiSources: Readonly<Record<string, string | Uint8Array>>
  /** Compiles the test-only display-list readout in; product builds leave it out. */
  testReadout: boolean
}

export type ComposeHmiFirmwareResult =
  | {
      ok: true
      /** Files by path in the firmware build folder. */
      files: Record<string, string>
      /** Lines appended to `defines.h`. */
      defines: string
      tags: HmiTag[]
      warnings: HmiDiagnostic[]
    }
  | { ok: false; errors: HmiDiagnostic[]; warnings: HmiDiagnostic[] }

const UNIT = 'HMI'
/** The fonts' licence in the build folder, beside the sketch and the exported binaries. */
export const HMI_FIRMWARE_FONTS_LICENSE = 'HMI-FONTS-LICENSE.txt'
const FONTS_LICENSE = 'fonts/LICENSE.txt'
const HOST_FILES = ['baremetal/hmi_baremetal.c', 'baremetal/hmi_baremetal.h', 'baremetal/hmi_panel.h']
const UNIT_HEADER = 'unit/hmi_unit.h'
const CORE_FILE = /^core\/(?:third_party\/)?[^/]+\.[ch]$/

const decoder = new TextDecoder()
const text = (content: string | Uint8Array): string => (typeof content === 'string' ? content : decoder.decode(content))

/**
 * Name of a unit file in the firmware's `src/`, which also holds the PLC program's STruC++ output (`configuration.cpp`,
 * `pou_<NAME>.cpp`): translation units get an `hmi_` prefix; headers keep their names, which the unit includes.
 */
export function hmiFirmwareUnitFileName(name: string): string {
  return name.endsWith('.cpp') && !name.startsWith('hmi_') ? `hmi_${name}` : name
}

/** Faces the firmware compiles in: those the screens draw, plus the PIN entry's face when the panel has a PIN. */
export function hmiFirmwareFaces(faces: readonly number[], pinEnabled: boolean): number[] {
  const all = new Set(faces)
  if (pinEnabled) all.add(HMI_FONT_REGULAR)
  return [...all].sort((a, b) => a - b)
}

/** Builds the HMI files of a firmware with screens. */
export async function composeHmiFirmware(input: ComposeHmiFirmwareInput): Promise<ComposeHmiFirmwareResult> {
  const unit = generateHmiUnit({
    ...input.sources,
    plcArchives: input.plcArchives,
    resolve: hmiTagResolver(input.debugMapJson, input.instances),
    plcMd5: input.md5,
  })
  if (!unit.ok) return { ok: false, errors: unit.errors, warnings: unit.warnings }
  const fail = (message: string): ComposeHmiFirmwareResult => ({
    ok: false,
    errors: [{ file: UNIT, message }],
    warnings: unit.warnings,
  })

  const files: Record<string, string> = {}
  for (const [path, content] of Object.entries(input.hmiSources)) {
    if (CORE_FILE.test(path)) files[`src/${path.slice('core/'.length)}`] = text(content)
  }
  if (files['src/hmi_core.h'] === undefined) return fail('The HMI sources have no core/')
  for (const path of [...HOST_FILES, UNIT_HEADER]) {
    const content = input.hmiSources[path]
    if (content === undefined) return fail(`The HMI sources have no ${path}`)
    files[`src/${path.slice(path.indexOf('/') + 1)}`] = text(content)
  }
  for (const [name, content] of Object.entries(unit.files)) files[`src/${hmiFirmwareUnitFileName(name)}`] = content
  try {
    const faces = hmiFirmwareFaces(unit.fonts.faces, input.sources.settings.pin.enabled)
    files['src/hmi_fonts.c'] = await hmiFontTableFromSources(faces, unit.fonts.variant, input.hmiSources)
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }
  files['src/hmi_config.h'] = hmiConfigHeader(input.panel, unit.fonts.variant, { testReadout: input.testReadout })
  const license = input.hmiSources[FONTS_LICENSE]
  if (license === undefined) return fail(`The HMI sources have no ${FONTS_LICENSE}`)
  files[HMI_FIRMWARE_FONTS_LICENSE] = text(license)

  return {
    ok: true,
    files,
    defines: input.testReadout ? '\n#define HMI_TEST_READOUT 1\n' : '',
    tags: unit.tags,
    warnings: unit.warnings,
  }
}
