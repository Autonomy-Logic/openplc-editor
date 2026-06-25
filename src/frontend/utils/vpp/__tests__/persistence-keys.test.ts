/**
 * Tests for the VPP persistence-key contract.
 *
 * Failures here indicate the shared `vendorScreenData` key resolution
 * has drifted between the write side (layouts) and the read side
 * (vendor-screen tab editor + save / revert handlers).  Any such
 * drift silently loses dirty-tracking for the affected sections —
 * the user toggles a field, the editor doesn't notice, the tab
 * closes without prompting.
 */

import { collectScreenPersistenceKeys, getSectionPersistenceKey } from '../persistence-keys'

describe('getSectionPersistenceKey', () => {
  it('returns explicit persistence when declared', () => {
    expect(getSectionPersistenceKey({ id: 'general', persistence: 'hal-config' })).toBe('hal-config')
  })

  it('falls back to section id when persistence is omitted', () => {
    expect(getSectionPersistenceKey({ id: 'general' })).toBe('general')
  })

  it('returns null when neither persistence nor id is usable', () => {
    expect(getSectionPersistenceKey({})).toBeNull()
    expect(getSectionPersistenceKey(null)).toBeNull()
    expect(getSectionPersistenceKey(undefined)).toBeNull()
  })

  it('ignores non-string / empty values for persistence and id', () => {
    expect(getSectionPersistenceKey({ persistence: '', id: 'fallback' })).toBe('fallback')
    expect(getSectionPersistenceKey({ persistence: 42 as unknown as string, id: 'fallback' })).toBe('fallback')
    expect(getSectionPersistenceKey({ persistence: '', id: '' })).toBeNull()
  })
})

describe('collectScreenPersistenceKeys', () => {
  it('walks every section in a typical multi-section screen', () => {
    const screen = {
      sections: [
        { id: 'general', persistence: 'hal-config', layout: 'form' },
        { id: 'modules', persistence: 'module-configuration', layout: 'module-slots' },
        { id: 'mapping', persistence: 'io-mapping', layout: 'io-table' },
      ],
    }
    expect(collectScreenPersistenceKeys(screen)).toEqual(['hal-config', 'module-configuration', 'io-mapping'])
  })

  it('falls back to section id for sections that omit persistence', () => {
    const screen = {
      sections: [
        { id: 'with-explicit', persistence: 'hal-config', layout: 'form' },
        { id: 'no-persistence', layout: 'form' },
      ],
    }
    expect(collectScreenPersistenceKeys(screen)).toEqual(['hal-config', 'no-persistence'])
  })

  it('returns [] for a screen with no sections', () => {
    expect(collectScreenPersistenceKeys({})).toEqual([])
    expect(collectScreenPersistenceKeys({ sections: 'oops' })).toEqual([])
  })

  it('returns [] for malformed / missing screen definitions', () => {
    expect(collectScreenPersistenceKeys(null)).toEqual([])
    expect(collectScreenPersistenceKeys(undefined)).toEqual([])
    expect(collectScreenPersistenceKeys('not-an-object')).toEqual([])
  })

  it('skips malformed sections (no id, no persistence) without throwing', () => {
    const screen = {
      sections: [
        { id: 'ok', layout: 'form' },
        {}, // malformed
        null, // also malformed
        { id: 'ok2', layout: 'form' },
      ],
    }
    expect(collectScreenPersistenceKeys(screen)).toEqual(['ok', 'ok2'])
  })

  it('mirrors the SLM-RP4 screen shape (regression for the GARAGEDO case)', () => {
    // Closest approximation of the synergy SLM-RP4's screen
    // definition: a hal-config + module-configuration pair.  The
    // editor's dirty-tracking + surgical save both depend on this
    // helper returning exactly the persistence keys the layouts
    // write to.
    const screen = {
      sections: [
        { id: 'hal', persistence: 'hal-config', layout: 'form', title: 'HAL' },
        { id: 'mods', persistence: 'module-configuration', layout: 'module-slots', title: 'Modules' },
      ],
    }
    const keys = collectScreenPersistenceKeys(screen)
    expect(keys).toContain('hal-config')
    expect(keys).toContain('module-configuration')
  })
})
