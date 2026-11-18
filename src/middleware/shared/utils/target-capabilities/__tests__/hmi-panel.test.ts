import {
  HMI_DEFAULT_BAND_BYTES,
  HMI_DEFAULT_DISPLAY_LIST_BYTES,
  HMI_DEFAULT_GLYPH_CACHE_BYTES,
  hmiPanelCapabilitySchema,
  resolveHmiPanel,
} from '../hmi-panel'
import {
  ARDUINO_CLI_CAPABILITIES,
  RUNTIME_V3_CAPABILITIES,
  RUNTIME_V4_CAPABILITIES,
  SIMULATOR_CAPABILITIES,
} from '../presets'
import { resolveTargetCapabilities } from '../resolve'

const PANEL = { width: 800, height: 480, density: 1, touch: true, colorFormat: 'rgb565' } as const

describe('the hmi capability', () => {
  it('fills the buffer sizes a declared panel leaves out', () => {
    const caps = resolveTargetCapabilities({ compiler: 'arduino-cli', capabilities: { hmi: PANEL } })
    expect(caps.hmi).toEqual({
      ...PANEL,
      touchCalibration: false,
      displayListBytes: HMI_DEFAULT_DISPLAY_LIST_BYTES,
      glyphCacheBytes: HMI_DEFAULT_GLYPH_CACHE_BYTES,
      bandBytes: HMI_DEFAULT_BAND_BYTES,
    })
    expect([HMI_DEFAULT_DISPLAY_LIST_BYTES, HMI_DEFAULT_GLYPH_CACHE_BYTES, HMI_DEFAULT_BAND_BYTES]).toEqual([
      16384, 8192, 20480,
    ])
  })

  it('keeps the buffer sizes a declared panel gives', () => {
    const declared = {
      ...PANEL,
      colorFormat: 'rgb888',
      displayListBytes: 4096,
      glyphCacheBytes: 2048,
      bandBytes: 65536,
    } as const
    const caps = resolveTargetCapabilities({ compiler: 'arduino-cli', capabilities: { hmi: declared } })
    expect(caps.hmi).toEqual({ ...declared, touchCalibration: false })
  })

  it('keeps a raw touch panel that needs calibrating, and the 18-bit format', () => {
    const declared = { ...PANEL, colorFormat: 'rgb666', touchCalibration: true } as const
    expect(resolveHmiPanel(declared)).toMatchObject({ colorFormat: 'rgb666', touchCalibration: true })
    expect(resolveHmiPanel({ ...PANEL, colorFormat: 'rgb555' })).toBeNull()
    expect(resolveHmiPanel({ ...PANEL, touchCalibration: 'yes' })).toBeNull()
  })

  it.each([
    ['simulator', SIMULATOR_CAPABILITIES],
    ['arduino-cli', ARDUINO_CLI_CAPABILITIES],
    ['openplc-compiler', RUNTIME_V4_CAPABILITIES],
  ])('resolves no panel for the %s preset', (compiler, preset) => {
    expect(preset.hmi).toBeNull()
    expect(resolveTargetCapabilities({ compiler }).hmi).toBeNull()
  })

  it('declares no panel on Runtime v3 or on an unknown board', () => {
    expect(RUNTIME_V3_CAPABILITIES.hmi).toBeNull()
    expect(resolveTargetCapabilities(undefined).hmi).toBeNull()
    expect(resolveTargetCapabilities({ compiler: 'unknown' }).hmi).toBeNull()
  })

  it('reads an explicit null as no panel', () => {
    expect(resolveTargetCapabilities({ compiler: 'arduino-cli', capabilities: { hmi: null } }).hmi).toBeNull()
  })

  it.each<[string, unknown]>([
    ['a missing colorFormat', { width: 800, height: 480, density: 1, touch: true }],
    ['a zero width', { ...PANEL, width: 0 }],
    ['a width over 4096', { ...PANEL, width: 4097 }],
    ['a fractional height', { ...PANEL, height: 480.5 }],
    ['a density of 9', { ...PANEL, density: 9 }],
    ['an unknown color format', { ...PANEL, colorFormat: 'rgb444' }],
    ['a band buffer under 1024 bytes', { ...PANEL, bandBytes: 512 }],
    ['a glyph cache over 1 MiB', { ...PANEL, glyphCacheBytes: 1048577 }],
    ['a misspelt size', { ...PANEL, bandByte: 4096 }],
    ['a string', 'panel'],
  ])('rejects a panel with %s', (_case, declared) => {
    expect(resolveHmiPanel(declared)).toBeNull()
  })

  it('refuses a band buffer smaller than one RGBA row of the panel', () => {
    expect(resolveHmiPanel({ ...PANEL, bandBytes: 3199 })).toBeNull()
    expect(resolveHmiPanel({ ...PANEL, bandBytes: 3200 })?.bandBytes).toBe(3200)
    const parsed = hmiPanelCapabilitySchema.safeParse({ ...PANEL, bandBytes: 1024 })
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(parsed.error.issues[0]).toMatchObject({
      path: ['bandBytes'],
      message: 'The HMI band buffer (bandBytes 1024) holds less than one panel row (3200 bytes for a width of 800)',
    })
  })

  it('resolves a board whose declared panel does not validate as having none', () => {
    const caps = resolveTargetCapabilities({ compiler: 'arduino-cli', capabilities: { hmi: { ...PANEL, density: 0 } } })
    expect(caps.hmi).toBeNull()
  })
})
