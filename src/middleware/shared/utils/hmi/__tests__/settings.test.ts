import {
  defaultHmiSettings,
  HMI_BUILTIN_THEMES,
  hmiSettingsSchema,
  hmiThemeId,
  parseHmiSettings,
  screenGrant,
} from '../settings'

function errorsOf(value: unknown): string[] {
  const parsed = parseHmiSettings(value)
  return parsed.ok ? [] : parsed.errors
}

describe('HMI settings', () => {
  it('fills the defaults of a new project', () => {
    expect(defaultHmiSettings()).toEqual({
      startScreen: '',
      framePeriodMs: 100,
      roles: {},
      pin: { enabled: false, value: '' },
      relock: { mode: 'never' },
      themes: [],
      defaultTheme: 'Autonomy',
      fontVariant: 'compact',
    })
  })

  it('keeps the frame period between 20 and 1000 ms', () => {
    expect(errorsOf({ framePeriodMs: 20 })).toEqual([])
    expect(errorsOf({ framePeriodMs: 1000 })).toEqual([])
    expect(errorsOf({ framePeriodMs: 19 })).toHaveLength(1)
    expect(errorsOf({ framePeriodMs: 1001 })).toHaveLength(1)
    expect(errorsOf({ framePeriodMs: 50.5 })).toHaveLength(1)
  })

  it('accepts a PIN of 4 to 8 digits, required only while enabled', () => {
    expect(errorsOf({ pin: { enabled: true, value: '1234' } })).toEqual([])
    expect(errorsOf({ pin: { enabled: true, value: '12345678' } })).toEqual([])
    expect(errorsOf({ pin: { enabled: false, value: '' } })).toEqual([])
    expect(errorsOf({ pin: { enabled: false, value: '4321' } })).toEqual([])
    for (const value of ['', '123', '123456789', '12a4'])
      expect(errorsOf({ pin: { enabled: true, value } })).toEqual(['pin.value: the PIN must be 4 to 8 digits'])
    expect(errorsOf({ pin: { enabled: false, value: '12' } })).toEqual(['pin.value: the PIN must be 4 to 8 digits'])
  })

  it('relocks never, or after 1 to 1440 idle minutes', () => {
    expect(errorsOf({ relock: { mode: 'idle', minutes: 1 } })).toEqual([])
    expect(errorsOf({ relock: { mode: 'idle', minutes: 1440 } })).toEqual([])
    expect(errorsOf({ relock: { mode: 'idle', minutes: 0 } })).toHaveLength(1)
    expect(errorsOf({ relock: { mode: 'idle' } })).toHaveLength(1)
    expect(errorsOf({ relock: { mode: 'sometimes' } })).toHaveLength(1)
  })

  it('checks project themes: identifier names, unique, a predefined base, #RRGGBB colors of known tokens', () => {
    const brand = { name: 'Brand', base: 'Light', colors: { Accent: '#7C3AED' } }
    expect(errorsOf({ themes: [brand], defaultTheme: 'Brand' })).toEqual([])
    expect(errorsOf({ themes: [{ ...brand, name: 'dark' }] })).toEqual([
      "themes.0.name: a theme named 'dark' already exists",
    ])
    expect(errorsOf({ themes: [brand, { ...brand, name: 'BRAND' }] })).toEqual([
      "themes.1.name: a theme named 'BRAND' already exists",
    ])
    expect(errorsOf({ themes: [{ ...brand, name: 'My Theme' }] })).toEqual([
      'themes.0.name: a theme name must be an identifier',
    ])
    expect(errorsOf({ themes: [{ ...brand, base: 'Brand' }] })).toHaveLength(1)
    expect(errorsOf({ themes: [{ ...brand, colors: { Accent: 'red' } }] })).toEqual([
      'themes.0.colors.Accent: a color must be #RRGGBB',
    ])
    expect(errorsOf({ themes: [{ ...brand, colors: { Glow: '#000000' } }] })).toEqual([
      "themes.0.colors.Glow: 'Glow' is not a theme color",
    ])
  })

  it('allows 16 themes in total and a default theme that exists', () => {
    const themes = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `T${i}`, base: 'Dark' }))
    expect(errorsOf({ themes: themes(16 - HMI_BUILTIN_THEMES.length) })).toEqual([])
    expect(errorsOf({ themes: themes(17 - HMI_BUILTIN_THEMES.length) })).toHaveLength(1)
    expect(errorsOf({ defaultTheme: 'Ocean' })).toEqual([])
    expect(errorsOf({ defaultTheme: 'Missing' })).toEqual(["defaultTheme: 'Missing' is not a theme"])
  })

  it('grants a screen without a grid entry to engineer only, matching names in any case', () => {
    const settings = hmiSettingsSchema.parse({ roles: { Overview: { engineer: true, operator: true, viewer: false } } })
    expect(screenGrant(settings, 'OVERVIEW')).toEqual({ engineer: true, operator: true, viewer: false })
    expect(screenGrant(settings, 'Details')).toEqual({ engineer: true, operator: false, viewer: false })
  })

  it('numbers themes as the C core does: predefined first, then project themes', () => {
    const settings = hmiSettingsSchema.parse({
      themes: [
        { name: 'Brand', base: 'Light' },
        { name: 'Night', base: 'Dark' },
      ],
    })
    expect(hmiThemeId(settings, 'autonomy')).toBe(0)
    expect(hmiThemeId(settings, 'Ocean')).toBe(4)
    expect(hmiThemeId(settings, 'Brand')).toBe(5)
    expect(hmiThemeId(settings, 'NIGHT')).toBe(6)
    expect(hmiThemeId(settings, 'Missing')).toBe(-1)
  })

  it('reports an error without a path for a value that is not an object', () => {
    expect(errorsOf('nope')).toEqual(['Expected object, received string'])
  })
})
