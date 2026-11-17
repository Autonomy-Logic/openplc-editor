import { resolveHmiPanel } from '../../../../../middleware/shared/utils/target-capabilities/hmi-panel'
import { hmiBoundsCapacity, hmiConfigHeader } from '../hmi-config-header'

function panel(declared: Record<string, unknown>) {
  const resolved = resolveHmiPanel({
    width: 320,
    height: 240,
    density: 1,
    touch: true,
    colorFormat: 'rgb565',
    ...declared,
  })
  if (!resolved) throw new Error('panel does not validate')
  return resolved
}

const defines = (header: string): Record<string, string> =>
  Object.fromEntries([...header.matchAll(/^#define (\w+)(?: (.+))?$/gm)].map((m) => [m[1], m[2] ?? '']))

describe('hmiConfigHeader', () => {
  it('sizes the static HMI from the panel, with the capability defaults', () => {
    const d = defines(hmiConfigHeader(panel({}), 'compact'))
    expect(d).toMatchObject({
      HMI_STATIC_MEMORY: '1',
      HMI_DL_CAPACITY: '16384',
      HMI_GLYPH_CACHE_BYTES: '8192',
      HMI_BAND_BYTES: '20480',
      HMI_STB_ARENA_BYTES: '10240',
      HMI_BOUNDS_MAX: '160',
      HMI_RASTER_ROW_MAX: '321',
      HMI_PANEL_WIDTH: '320',
      HMI_PANEL_HEIGHT: '240',
      HMI_PANEL_DENSITY: '1',
      HMI_PANEL_TOUCH: '1',
      HMI_PANEL_RGB565: '1',
    })
    expect(d.HMI_TEST_READOUT).toBeUndefined()
  })

  it('takes the sizes a board declares', () => {
    const d = defines(
      hmiConfigHeader(
        panel({
          width: 800,
          height: 480,
          density: 2,
          touch: false,
          colorFormat: 'rgb888',
          displayListBytes: 65536,
          glyphCacheBytes: 32768,
          bandBytes: 102400,
        }),
        'full',
      ),
    )
    expect(d).toMatchObject({
      HMI_DL_CAPACITY: '65536',
      HMI_GLYPH_CACHE_BYTES: '32768',
      HMI_BAND_BYTES: '102400',
      HMI_STB_ARENA_BYTES: '24576',
      HMI_BOUNDS_MAX: '192',
      HMI_RASTER_ROW_MAX: '801',
      HMI_PANEL_DENSITY: '2',
      HMI_PANEL_TOUCH: '0',
      HMI_PANEL_RGB565: '0',
    })
  })

  it('sizes the touch table from the screen area in screen units, at least 64 entries', () => {
    expect(hmiBoundsCapacity(panel({}))).toBe(160)
    expect(hmiBoundsCapacity(panel({ width: 800, height: 480 }))).toBe(736)
    expect(hmiBoundsCapacity(panel({ width: 800, height: 480, density: 2 }))).toBe(192)
    expect(hmiBoundsCapacity(panel({ width: 128, height: 64 }))).toBe(64)
  })

  it('defines the test readout only when asked', () => {
    expect(defines(hmiConfigHeader(panel({}), 'compact', { testReadout: true })).HMI_TEST_READOUT).toBe('1')
    expect(hmiConfigHeader(panel({}), 'compact', { testReadout: false })).not.toContain('HMI_TEST_READOUT')
  })

  it('is guarded against a second inclusion', () => {
    const header = hmiConfigHeader(panel({}), 'compact')
    expect(header).toMatch(/^#ifndef HMI_CONFIG_H\n#define HMI_CONFIG_H$/m)
    expect(header.trimEnd().endsWith('#endif')).toBe(true)
  })
})
