import {
  DEFAULT_UI_PREFERENCES,
  loadUiPreferences,
  parseUiPreferences,
  persistUiPreferences,
  UI_PREFERENCES_STORAGE_KEY,
} from '../ui-preferences-storage'

describe('ui-preferences-storage', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to the radial menu enabled', () => {
    expect(DEFAULT_UI_PREFERENCES.radialMenuEnabled).toBe(true)
    expect(parseUiPreferences(null)).toEqual(DEFAULT_UI_PREFERENCES)
  })

  it('parses a stored payload', () => {
    expect(parseUiPreferences('{"radialMenuEnabled":false}')).toEqual({ radialMenuEnabled: false })
  })

  it('falls back to the defaults on invalid JSON or schema', () => {
    expect(parseUiPreferences('{not json')).toEqual(DEFAULT_UI_PREFERENCES)
    expect(parseUiPreferences('{"radialMenuEnabled":"no"}')).toEqual(DEFAULT_UI_PREFERENCES)
    expect(parseUiPreferences('{}')).toEqual(DEFAULT_UI_PREFERENCES)
  })

  it('round-trips through localStorage', () => {
    persistUiPreferences({ radialMenuEnabled: false })
    expect(localStorage.getItem(UI_PREFERENCES_STORAGE_KEY)).toBe('{"radialMenuEnabled":false}')
    expect(loadUiPreferences()).toEqual({ radialMenuEnabled: false })
  })

  it('tolerates a missing storage', () => {
    expect(loadUiPreferences(undefined)).toEqual(DEFAULT_UI_PREFERENCES)
    expect(() => persistUiPreferences(DEFAULT_UI_PREFERENCES, undefined)).not.toThrow()
  })

  it('tolerates a throwing storage', () => {
    const failing = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('quota')
      },
    }
    expect(loadUiPreferences(failing)).toEqual(DEFAULT_UI_PREFERENCES)
    expect(() => persistUiPreferences(DEFAULT_UI_PREFERENCES, failing)).not.toThrow()
  })
})
