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
  getSectionVppExtensionScreenId,
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

  it('gives a vendor-document section the configurator key by default', () => {
    expect(getSectionPersistenceKey({ id: 'editor', layout: 'vendor-document' })).toBe('configurator')
  })

  it('honours an explicit persistence override on a vendor-document section', () => {
    expect(getSectionPersistenceKey({ id: 'editor', layout: 'vendor-document', persistence: 'cfg' })).toBe('cfg')
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

  it('returns null for a vpp-extensions section — its data lives under project.data.vppExtensions, not vendorScreenData', () => {
    // The current `com.weidmuller.ucontrol` data-hub screen used
    // `persistence: "vpp-extensions"` and vendor-document; the string literal
    // was dead code (nothing ever wrote vendorScreenData["vpp-extensions"]).
    // Returning null here steers the vendor-screen dirty-tracking away from a
    // slice that never had the data, matching the bulk save of vppExtensions.
    expect(
      getSectionPersistenceKey({ id: 'data-hub', layout: 'vendor-document', persistence: 'vpp-extensions' }),
    ).toBeNull()
    expect(getSectionPersistenceKey({ id: 'connection', layout: 'form', persistence: 'vpp-extensions' })).toBeNull()
    expect(
      getSectionPersistenceKey({
        id: 'variables',
        layout: 'table',
        persistence: 'vpp-extensions',
        storageId: 'data-hub',
      }),
    ).toBeNull()
  })

  it('leaves every other section at exactly the key it has today (storageId is opt-in and ignored off vpp-extensions)', () => {
    // Backward-compat guard: packages the editor already ships (slm-rp4,
    // p2-722, simatic-bx35a, the Weidmuller configurator) must keep the same
    // key the write side writes, or dirty-tracking silently loses edits.
    expect(getSectionPersistenceKey({ id: 'hal', persistence: 'hal-config', layout: 'form' })).toBe('hal-config')
    expect(getSectionPersistenceKey({ id: 'mods', persistence: 'module-configuration', layout: 'module-slots' })).toBe(
      'module-configuration',
    )
    expect(getSectionPersistenceKey({ id: 'mapping', persistence: 'io-mapping', layout: 'io-table' })).toBe(
      'io-mapping',
    )
    expect(getSectionPersistenceKey({ id: 'editor', layout: 'vendor-document' })).toBe('configurator')
    // storageId on a non-vpp-extensions section is inert.
    expect(getSectionPersistenceKey({ id: 'hal', persistence: 'hal-config', layout: 'form', storageId: 'bogus' })).toBe(
      'hal-config',
    )
    expect(getSectionPersistenceKey({ id: 'general', layout: 'form', storageId: 'bogus' })).toBe('general')
  })
})

describe('getSectionVppExtensionScreenId', () => {
  it('returns the section id by default for a vpp-extensions section', () => {
    expect(getSectionVppExtensionScreenId({ id: 'data-hub', layout: 'form', persistence: 'vpp-extensions' })).toBe(
      'data-hub',
    )
  })

  it('lets storageId override the screen id so sibling sections share one vpp-extensions bucket', () => {
    const connection = { id: 'connection', layout: 'form', persistence: 'vpp-extensions', storageId: 'data-hub' }
    const variables = { id: 'variables', layout: 'table', persistence: 'vpp-extensions', storageId: 'data-hub' }
    expect(getSectionVppExtensionScreenId(connection)).toBe('data-hub')
    expect(getSectionVppExtensionScreenId(variables)).toBe('data-hub')
  })

  it('returns null for a section whose persistence is anything other than vpp-extensions', () => {
    expect(getSectionVppExtensionScreenId({ id: 'hal', persistence: 'hal-config', layout: 'form' })).toBeNull()
    expect(getSectionVppExtensionScreenId({ id: 'anything', layout: 'form' })).toBeNull()
    // storageId is inert outside vpp-extensions — a package that misuses it must not reach the vpp-extensions store.
    expect(getSectionVppExtensionScreenId({ id: 'hal', persistence: 'hal-config', storageId: 'elsewhere' })).toBeNull()
  })

  it('returns null for malformed input', () => {
    expect(getSectionVppExtensionScreenId(null)).toBeNull()
    expect(getSectionVppExtensionScreenId(undefined)).toBeNull()
    expect(getSectionVppExtensionScreenId({})).toBeNull()
    // persistence set but no usable id — the write side has nowhere to go.
    expect(getSectionVppExtensionScreenId({ persistence: 'vpp-extensions' })).toBeNull()
    expect(getSectionVppExtensionScreenId({ persistence: 'vpp-extensions', id: '' })).toBeNull()
    // Non-string storageId falls through to id.
    expect(
      getSectionVppExtensionScreenId({
        id: 'fallback',
        persistence: 'vpp-extensions',
        storageId: 42 as unknown as string,
      }),
    ).toBe('fallback')
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

  it('skips vpp-extensions sections — the project store serializes their bucket in bulk', () => {
    const screen = {
      sections: [
        { id: 'connection', layout: 'form', persistence: 'vpp-extensions', storageId: 'data-hub' },
        { id: 'variables', layout: 'table', persistence: 'vpp-extensions', storageId: 'data-hub' },
      ],
    }
    expect(collectScreenPersistenceKeys(screen)).toEqual([])
  })

  it('still owns the configurator chain when a non-vpp-extensions vendor-document section is present', () => {
    // Regression guard: swapping to the new vpp-extensions routing must not change
    // what a configurator screen owns. The device-setup/module-configuration/io-mapping
    // keys stay with vendor-document sections that are configurator-backed.
    const screen = {
      sections: [
        { id: 'editor', layout: 'vendor-document' },
        { id: 'connection', layout: 'form', persistence: 'vpp-extensions', storageId: 'extras' },
      ],
    }
    expect(collectScreenPersistenceKeys(screen)).toEqual([
      'configurator',
      'device-setup',
      'module-configuration',
      'io-mapping',
    ])
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
