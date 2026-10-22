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

import {
  collectConfiguratorKeys,
  collectLinkedConfiguratorKeys,
  collectLinkedScreenKeys,
  collectScreenPersistenceKeys,
  configuratorScreenNames,
  getSectionPersistenceKey,
  linkedScreenNames,
} from '../persistence-keys'

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

  it('always gives a vendor-document section the configurator key', () => {
    expect(getSectionPersistenceKey({ id: 'editor', layout: 'vendor-document' })).toBe('configurator')
    expect(getSectionPersistenceKey({ id: 'editor', layout: 'vendor-document', persistence: 'cfg' })).toBe(
      'configurator',
    )
  })

  it('pins a device-setup io-table section to the I/O mapping a configurator writes', () => {
    const section = { id: 'mapping', layout: 'io-table', source: 'device-setup' }
    expect(getSectionPersistenceKey(section)).toBe('io-mapping')
    expect(getSectionPersistenceKey({ ...section, persistence: 'other' })).toBe('io-mapping')
  })

  it('leaves an io-table without a source on its own key', () => {
    expect(getSectionPersistenceKey({ id: 'table', layout: 'io-table', persistence: 'other' })).toBe('other')
    expect(collectScreenPersistenceKeys({ sections: [{ id: 'table', layout: 'io-table' }] })).toEqual(['table'])
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

describe('vendor-document ownership', () => {
  const screen = {
    sections: [
      { id: 'editor', layout: 'vendor-document' },
      { id: 'mapping', persistence: 'io-mapping', layout: 'io-table', source: 'device-setup' },
    ],
  }

  it('owns the device setup, the module slots and the I/O mapping it writes alongside the archive', () => {
    expect(collectScreenPersistenceKeys(screen)).toEqual([
      'configurator',
      'device-setup',
      'module-configuration',
      'io-mapping',
    ])
  })

  it('gives an I/O Mapping screen without the configurator the archive and the same three keys', () => {
    expect(
      collectScreenPersistenceKeys({ sections: [{ id: 'mapping', layout: 'io-table', source: 'device-setup' }] }),
    ).toEqual(['io-mapping', 'configurator', 'device-setup', 'module-configuration'])
  })

  it('lists only configurator sections as archive keys', () => {
    expect(collectConfiguratorKeys(screen)).toEqual(['configurator'])
    expect(collectConfiguratorKeys({ sections: [{ id: 'hal', layout: 'form' }] })).toEqual([])
  })
})

describe('configurator screens linked across tabs', () => {
  const screens = {
    'Backplane Configuration': { sections: [{ id: 'configurator', layout: 'vendor-document' }] },
    'I/O Mapping': {
      sections: [{ id: 'io-mapping', layout: 'io-table', source: 'device-setup', persistence: 'io-mapping' }],
    },
    Network: { sections: [{ id: 'network', layout: 'form' }] },
  }

  it('links the configurator and I/O Mapping screens, and nothing else', () => {
    expect(configuratorScreenNames(screens)).toEqual(['Backplane Configuration', 'I/O Mapping'])
    expect(linkedScreenNames(screens, 'I/O Mapping')).toEqual(['Backplane Configuration', 'I/O Mapping'])
    expect(linkedScreenNames(screens, 'Network')).toEqual(['Network'])
  })

  it('gives each linked screen the archive, the device setup, the module slots and the mapping', () => {
    for (const name of ['Backplane Configuration', 'I/O Mapping']) {
      expect([...collectLinkedScreenKeys(screens, name)].sort()).toEqual([
        'configurator',
        'device-setup',
        'io-mapping',
        'module-configuration',
      ])
      expect(collectLinkedConfiguratorKeys(screens, name)).toEqual(['configurator'])
    }
    expect(collectLinkedScreenKeys(screens, 'Network')).toEqual(['network'])
    expect(collectLinkedConfiguratorKeys(screens, 'Network')).toEqual([])
  })

  it('leaves a board without a configurator screen unlinked', () => {
    expect(configuratorScreenNames(undefined)).toEqual([])
    expect(linkedScreenNames({ Network: screens.Network }, 'Network')).toEqual(['Network'])
  })
})
