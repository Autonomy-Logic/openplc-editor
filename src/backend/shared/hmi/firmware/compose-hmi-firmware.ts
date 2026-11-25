/**
 * The HMI files of a baremetal firmware build for a board with a panel: the generated unit, the HMI core, the font
 * table of the faces the build draws, `hmi_config.h` and the baremetal host, flat under the sketch library `src/`, plus
 * the fonts' licence next to the firmware (not compiled, not flashed). Baremetal.ino picks the host up through
 * `__has_include(<hmi_baremetal.h>)`, so a build without these files has no HMI.
 */
import type { HmiBuildSources, HmiDiagnostic } from '../../../../middleware/shared/ports/hmi-preview-types'
import {
  hmiBandBelowRowMessage,
  type ResolvedHmiPanel,
} from '../../../../middleware/shared/utils/target-capabilities/hmi-panel'
import { type HmiProgramInstance, hmiTagResolver } from '../artefact/tag-resolver'
import { hmiFontTableFromSources } from '../fonts/font-table-source'
import { hmiFontBoxes, hmiLargestTextSize } from '../fonts/glyph-box'
import { HMI_FONT_REGULAR, type HmiFontVariant, vettedHmiFont } from '../fonts/vetted-fonts'
import { generateHmiUnit, type HmiTag } from '../unit/generate-hmi-unit'
import { HMI_GLYPH_SCRATCH_BYTES, hmiConfigHeader } from './hmi-config-header'

export interface ComposeHmiFirmwareInput {
  sources: HmiBuildSources
  panel: ResolvedHmiPanel
  /** The build's library archives, verbatim: the PLC libraries the program was compiled with and the widget libraries. */
  libraries: readonly unknown[]
  /** The target's capabilities; widgets that need one it lacks are refused. */
  capabilities: object
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

/**
 * Faces the firmware compiles in: those the screens draw, plus the regular face the panel's own screens (startup,
 * calibration, PIN entry) draw with.
 */
export function hmiFirmwareFaces(faces: readonly number[]): number[] {
  return [...new Set([...faces, HMI_FONT_REGULAR])].sort((a, b) => a - b)
}

/**
 * Largest text size, in screen units, whose glyphs a static build draws on the panel in every face compiled in; null
 * when a face's file is missing from the sources.
 */
export function hmiLargestPanelTextSize(
  faces: readonly number[],
  variant: HmiFontVariant,
  density: number,
  hmiSources: Readonly<Record<string, string | Uint8Array>>,
): number | null {
  let largest: number | null = null
  for (const id of faces) {
    const file = vettedHmiFont(id, variant)?.file
    const bytes = file === undefined ? undefined : hmiSources[`fonts/${file}`]
    if (!(bytes instanceof Uint8Array)) return null
    const size = hmiLargestTextSize(hmiFontBoxes(bytes), density, HMI_GLYPH_SCRATCH_BYTES)
    largest = largest === null ? size : Math.min(largest, size)
  }
  return largest
}

/** Builds the HMI files of a firmware with screens. */
export async function composeHmiFirmware(input: ComposeHmiFirmwareInput): Promise<ComposeHmiFirmwareResult> {
  if (input.panel.bandBytes < input.panel.width * 4) {
    return {
      ok: false,
      errors: [{ file: UNIT, message: hmiBandBelowRowMessage(input.panel.bandBytes, input.panel.width) }],
      warnings: [],
    }
  }
  const unit = generateHmiUnit({
    ...input.sources,
    projectLibraries: input.libraries,
    capabilities: input.capabilities,
    resolve: hmiTagResolver(input.debugMapJson, input.instances),
    plcMd5: input.md5,
    panel: true,
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
  const faces = hmiFirmwareFaces(unit.fonts.faces)
  try {
    files['src/hmi_fonts.c'] = await hmiFontTableFromSources(faces, unit.fonts.variant, input.hmiSources)
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }
  const warnings = [...unit.warnings]
  const largest = hmiLargestPanelTextSize(faces, unit.fonts.variant, input.panel.density, input.hmiSources)
  for (const t of unit.textSizes) {
    if (largest === null || t.size <= largest) continue
    warnings.push({
      file: t.screen,
      message: `${t.element}: text size ${t.size} is larger than this board's panel draws (${largest}); its glyphs are not drawn on the device`,
    })
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
    warnings,
  }
}
