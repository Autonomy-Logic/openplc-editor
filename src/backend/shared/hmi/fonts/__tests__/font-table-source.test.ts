import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { buildHmiFontTableSource, HmiFontError } from '../font-table-source'
import {
  DEFAULT_HMI_FONT_VARIANT,
  HMI_FONT_BOLD,
  HMI_FONT_REGULAR,
  VETTED_HMI_FONTS,
  vettedHmiFont,
} from '../vetted-fonts'

/* The bundled fonts: resources/sources/hmi/fonts in the editor, src/assets/firmware/hmi/fonts on the web. */
const FONT_DIRS = ['resources/sources/hmi/fonts', 'src/assets/firmware/hmi/fonts']
const fontDir = FONT_DIRS.map((dir) => join(process.cwd(), dir)).find((dir) => existsSync(dir))

function bundled(file: string): Uint8Array {
  if (!fontDir) throw new Error('bundled HMI fonts not found')
  return new Uint8Array(readFileSync(join(fontDir, file)))
}

const compactRegular = () => bundled('OpenPLCSans-Regular.ttf')
const compactBold = () => bundled('OpenPLCSans-Bold.ttf')
const fullRegular = () => bundled('LiberationSans-Regular.ttf')

describe('vetted HMI fonts', () => {
  it('has both faces in both variants, and the compact variant is the default', () => {
    expect(VETTED_HMI_FONTS.map((f) => `${f.variant}:${f.id}`).sort()).toEqual([
      'compact:0',
      'compact:1',
      'full:0',
      'full:1',
    ])
    expect(DEFAULT_HMI_FONT_VARIANT).toBe('compact')
    expect(vettedHmiFont(HMI_FONT_REGULAR, 'compact')?.file).toBe('OpenPLCSans-Regular.ttf')
    expect(vettedHmiFont(HMI_FONT_BOLD, 'full')?.file).toBe('LiberationSans-Bold.ttf')
  })
})

describe('buildHmiFontTableSource', () => {
  it('accepts every bundled font as vetted', async () => {
    for (const font of VETTED_HMI_FONTS) {
      await expect(
        buildHmiFontTableSource([{ id: font.id, variant: font.variant, bytes: bundled(font.file) }]),
      ).resolves.toContain('hmi_font_table')
    }
  })

  it('uses the compact variant when none is given', async () => {
    await expect(buildHmiFontTableSource([{ id: HMI_FONT_REGULAR, bytes: compactRegular() }])).resolves.toContain(
      `hmi_font_0[${compactRegular().length}]`,
    )
    await expect(buildHmiFontTableSource([{ id: HMI_FONT_REGULAR, bytes: fullRegular() }])).rejects.toThrow(
      'Font OpenPLCSans-Regular.ttf does not match the bundled copy',
    )
  })

  it('embeds only the faces given and leaves the others NULL', async () => {
    const source = await buildHmiFontTableSource([{ id: HMI_FONT_REGULAR, variant: 'full', bytes: fullRegular() }])
    expect(source).toContain(`static const unsigned char hmi_font_0[${fullRegular().length}] = {`)
    expect(source).not.toContain('hmi_font_1[')
    expect(source).toContain('const unsigned char *const hmi_font_table[HMI_FONTS] = {hmi_font_0, 0};')
    expect(source).toContain('_Static_assert(HMI_FONTS == 2,')
  })

  it('writes the bytes in order', async () => {
    const bytes = compactBold()
    const source = await buildHmiFontTableSource([{ id: HMI_FONT_BOLD, bytes }])
    const start = source.indexOf('hmi_font_1[')
    const body = source.slice(start, source.indexOf('};', start))
    const values = body
      .slice(body.indexOf('{') + 1)
      .split(/[,\s]+/)
      .filter((v) => v !== '')
      .map(Number)
    expect(values).toEqual(Array.from(bytes))
    expect(source).toContain('= {0, hmi_font_1};')
  })

  it('builds an empty table when no screen uses text', async () => {
    const source = await buildHmiFontTableSource([])
    expect(source).toContain('= {0, 0};')
    expect(source).not.toContain('static const unsigned char')
  })

  it('refuses a font that differs from the bundled copy', async () => {
    const tampered = compactRegular()
    tampered[100] ^= 1
    await expect(buildHmiFontTableSource([{ id: HMI_FONT_REGULAR, bytes: tampered }])).rejects.toThrow(
      new HmiFontError('Font OpenPLCSans-Regular.ttf does not match the bundled copy'),
    )
  })

  it('refuses another face under a vetted id', async () => {
    await expect(buildHmiFontTableSource([{ id: HMI_FONT_REGULAR, bytes: compactBold() }])).rejects.toThrow(
      'does not match the bundled copy',
    )
  })

  it('refuses an id that is not a bundled font', async () => {
    await expect(buildHmiFontTableSource([{ id: 7, bytes: compactRegular() }])).rejects.toThrow(
      'Font id 7 (compact) is not a bundled HMI font',
    )
  })

  it('refuses a face given twice', async () => {
    await expect(
      buildHmiFontTableSource([
        { id: HMI_FONT_REGULAR, bytes: compactRegular() },
        { id: HMI_FONT_REGULAR, bytes: compactRegular() },
      ]),
    ).rejects.toThrow('Font id 0 was given more than once')
  })

  it('refuses variants mixed in one build', async () => {
    await expect(
      buildHmiFontTableSource([
        { id: HMI_FONT_REGULAR, variant: 'full', bytes: fullRegular() },
        { id: HMI_FONT_BOLD, variant: 'compact', bytes: compactBold() },
      ]),
    ).rejects.toThrow('The fonts of one build must all be the same variant')
  })
})
