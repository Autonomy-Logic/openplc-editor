import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

import { resolveHmiPanel } from '../../../../../middleware/shared/utils/target-capabilities/hmi-panel'
import { HMI_FONT_BOLD, HMI_FONT_REGULAR } from '../../fonts/vetted-fonts'
import { sampleProject } from '../../unit/__tests__/fixtures/sample-project'
import {
  composeHmiFirmware,
  type ComposeHmiFirmwareInput,
  HMI_FIRMWARE_FONTS_LICENSE,
  hmiFirmwareFaces,
  hmiFirmwareUnitFileName,
} from '../compose-hmi-firmware'

/* The bundled HMI sources: resources/sources/hmi in the editor, src/assets/firmware/hmi on the web. */
const HMI_DIR =
  ['resources/sources/hmi', 'src/assets/firmware/hmi']
    .map((dir) => join(process.cwd(), dir))
    .find((dir) => existsSync(dir)) ?? 'missing-hmi-sources'

function readAll(dir: string, prefix = ''): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {}
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) Object.assign(out, readAll(path, `${prefix}${entry.name}/`))
    else out[`${prefix}${entry.name}`] = new Uint8Array(readFileSync(path))
  }
  return out
}

const HMI_SOURCES = readAll(HMI_DIR)

const LEAVES = [
  ['INSTANCE0.LEVEL', 0, 3],
  ['INSTANCE0.RUNNING', 0, 4],
  ['INSTANCE0.SPEED', 0, 5],
  ['INSTANCE0.TAG', 1, 0],
  ['ALARMON', 2, 0],
].map(([path, arrayIdx, elemIdx]) => ({ path, arrayIdx, elemIdx, type: 'BOOL', size: 1 }))

const PANEL = resolveHmiPanel({ width: 320, height: 240, density: 1, touch: true, colorFormat: 'rgb565' })

function input(overrides: Partial<ComposeHmiFirmwareInput> = {}): ComposeHmiFirmwareInput {
  if (!PANEL) throw new Error('the test panel does not validate')
  return {
    sources: sampleProject(),
    panel: PANEL,
    plcArchives: [],
    debugMapJson: JSON.stringify({ version: 2, md5: 'x', leaves: LEAVES }),
    md5: 'fe3845fc1babc413455ceb7a5ee596bf',
    instances: [{ name: 'instance0', program: 'Main' }],
    hmiSources: HMI_SOURCES,
    testReadout: false,
    ...overrides,
  }
}

describe('composeHmiFirmware', () => {
  it('lays the unit, the core, the font table, the config and the host flat under src/', async () => {
    const result = await composeHmiFirmware(input())
    if (!result.ok) throw new Error(JSON.stringify(result.errors))
    const { files } = result
    for (const name of ['hmi_core.c', 'hmi_core.h', 'hmi_internal.h', 'hmi_raster.c', 'hmi_text.c', 'hmi_theme.c'])
      expect(files[`src/${name}`]).toBeDefined()
    expect(files['src/third_party/stb_truetype.h']).toBeDefined()
    for (const name of ['hmi_baremetal.c', 'hmi_baremetal.h', 'hmi_panel.h', 'hmi_unit.h', 'hmi_unit.hpp'])
      expect(files[`src/${name}`]).toBeDefined()
    expect(files['src/hmi_unit_glue.cpp']).toContain('{2u, 0u, 1, 0, "CONFIG0.ALARMON"},')
    expect(files['src/hmi_unit_glue.cpp']).toContain('const char hmi_plc_md5[] = "fe3845fc1babc413455ceb7a5ee596bf";')
    expect(files['src/hmi_fonts.c']).toContain('hmi_font_table')
    expect(files['src/hmi_config.h']).toContain('#define HMI_STATIC_MEMORY 1')
    expect(result.defines).toBe('')
    expect(result.tags.map((t) => t.address)).toContainEqual({ arr: 0, elem: 4 })
  })

  it('keeps the unit translation units apart from the PLC program files in the same src/', async () => {
    const result = await composeHmiFirmware(input())
    if (!result.ok) throw new Error(JSON.stringify(result.errors))
    const units = Object.keys(result.files).filter((path) => path.endsWith('.cpp'))
    expect(units.length).toBeGreaterThan(1)
    for (const path of units) expect(path).toMatch(/^src\/hmi_/)
    expect(result.files['src/configuration.cpp']).toBeUndefined()
  })

  it('writes the fonts licence next to the firmware, outside the compiled library', async () => {
    const result = await composeHmiFirmware(input())
    if (!result.ok) throw new Error(JSON.stringify(result.errors))
    expect(HMI_FIRMWARE_FONTS_LICENSE.startsWith('src/')).toBe(false)
    expect(result.files[HMI_FIRMWARE_FONTS_LICENSE]).toContain('SIL OPEN FONT LICENSE')
  })

  it('compiles the test readout in only when asked', async () => {
    const product = await composeHmiFirmware(input())
    const readout = await composeHmiFirmware(input({ testReadout: true }))
    if (!product.ok || !readout.ok) throw new Error('compose failed')
    expect(product.files['src/hmi_config.h']).not.toContain('HMI_TEST_READOUT')
    expect(readout.files['src/hmi_config.h']).toContain('#define HMI_TEST_READOUT 1')
    expect(readout.defines).toContain('#define HMI_TEST_READOUT 1')
  })

  it('refuses a screen variable the program has no debug address for', async () => {
    const result = await composeHmiFirmware(input({ debugMapJson: JSON.stringify({ leaves: [] }) }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.map((e) => e.message).join('\n')).toMatch(/has no debug address/)
  })

  it('warns about a literal text size larger than the panel draws, and only then', async () => {
    const withSize = (size: number): ComposeHmiFirmwareInput => {
      const sample = sampleProject()
      const screens = sample.screens.map((s) =>
        s.name === 'Details'
          ? {
              ...s,
              source: s.source.replace(
                "Shown : HmiLabel := (Parent := 'Body')",
                `Shown : HmiLabel := (Parent := 'Body', Size := ${size})`,
              ),
            }
          : s,
      )
      if (screens.every((s) => !s.source.includes(`Size := ${size}`)))
        throw new Error('the sample Details screen changed')
      return input({ sources: { ...sample, screens } })
    }
    const large = await composeHmiFirmware(withSize(120))
    if (!large.ok) throw new Error(JSON.stringify(large.errors))
    expect(large.warnings).toContainEqual({
      file: 'Details',
      message:
        "Shown: text size 120 is larger than this board's panel draws (103); its glyphs are not drawn on the device",
    })
    const fits = await composeHmiFirmware(withSize(100))
    if (!fits.ok) throw new Error(JSON.stringify(fits.errors))
    expect(fits.warnings.map((w) => w.message).join('\n')).not.toMatch(/text size/)
  })

  it('refuses a band buffer smaller than one panel row', async () => {
    if (!PANEL) throw new Error('the test panel does not validate')
    const result = await composeHmiFirmware(input({ panel: { ...PANEL, width: 800, bandBytes: 1024 } }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0].message).toBe(
      'The HMI band buffer (bandBytes 1024) holds less than one panel row (3200 bytes for a width of 800)',
    )
  })

  it('fails without the baremetal host in the HMI sources', async () => {
    const { 'baremetal/hmi_baremetal.c': _host, ...rest } = HMI_SOURCES
    const result = await composeHmiFirmware(input({ hmiSources: rest }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0].message).toContain('baremetal/hmi_baremetal.c')
  })
})

describe('hmiFirmwareFaces', () => {
  it('adds the PIN entry face when the panel has a PIN', () => {
    expect(hmiFirmwareFaces([HMI_FONT_BOLD], true)).toEqual([HMI_FONT_REGULAR, HMI_FONT_BOLD])
    expect(hmiFirmwareFaces([], true)).toEqual([HMI_FONT_REGULAR])
  })

  it('keeps only the screens faces without a PIN', () => {
    expect(hmiFirmwareFaces([HMI_FONT_BOLD], false)).toEqual([HMI_FONT_BOLD])
    expect(hmiFirmwareFaces([], false)).toEqual([])
  })
})

describe('hmiFirmwareUnitFileName', () => {
  it('prefixes translation units and keeps headers', () => {
    expect(hmiFirmwareUnitFileName('configuration.cpp')).toBe('hmi_configuration.cpp')
    expect(hmiFirmwareUnitFileName('pou_OVERVIEW.cpp')).toBe('hmi_pou_OVERVIEW.cpp')
    expect(hmiFirmwareUnitFileName('hmi_unit_glue.cpp')).toBe('hmi_unit_glue.cpp')
    expect(hmiFirmwareUnitFileName('hmi_unit.hpp')).toBe('hmi_unit.hpp')
  })
})
