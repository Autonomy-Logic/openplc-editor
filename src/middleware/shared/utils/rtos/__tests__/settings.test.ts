/**
 * The per-board RTOS switch, read from `vendorScreenData.rtos`.
 *
 * Only an explicit boolean is the user's choice; everything else — no section,
 * a section with no `enabled`, a value the form never writes — is the default.
 */

import { readRtosSettings, RTOS_DEFAULT_ENABLED, RTOS_SETTINGS_SECTION } from '../settings'

describe('readRtosSettings', () => {
  it('reads the switch from the rtos section', () => {
    expect(RTOS_SETTINGS_SECTION).toBe('rtos')
    expect(readRtosSettings({ rtos: { enabled: true } })).toEqual({ enabled: true, chosen: true })
    expect(readRtosSettings({ rtos: { enabled: false } })).toEqual({ enabled: false, chosen: true })
  })

  it('falls back to the default when the user never touched it', () => {
    expect(readRtosSettings(undefined)).toEqual({ enabled: RTOS_DEFAULT_ENABLED, chosen: false })
    expect(readRtosSettings({})).toEqual({ enabled: RTOS_DEFAULT_ENABLED, chosen: false })
    expect(readRtosSettings({ rtos: {} })).toEqual({ enabled: RTOS_DEFAULT_ENABLED, chosen: false })
    expect(readRtosSettings({ rtos: null })).toEqual({ enabled: RTOS_DEFAULT_ENABLED, chosen: false })
  })

  it('does not read a stray value as a choice', () => {
    expect(readRtosSettings({ rtos: { enabled: 'true' } })).toEqual({ enabled: RTOS_DEFAULT_ENABLED, chosen: false })
    expect(readRtosSettings({ rtos: true })).toEqual({ enabled: RTOS_DEFAULT_ENABLED, chosen: false })
  })
})
