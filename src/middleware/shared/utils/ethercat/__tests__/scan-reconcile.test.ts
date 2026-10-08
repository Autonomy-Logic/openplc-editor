/**
 * DOPE-704 E6 scan-reconcile tests.
 *
 * The three pure helpers for the scan-modules workflow: parse the untyped scan reply,
 * diff it against the project, and apply the diff. Covers the four reconciliation
 * kinds (add / remove / keep / replace), the empty-slot sentinel, the untrusted-input
 * guard rails, and the identity case so the UI knows when to show "no changes".
 */

import type { ConfiguredEtherCATDevice, ConfiguredEtherCATModule } from '@root/middleware/shared/ports/esi-types'

import { createDefaultSlaveConfig } from '@root/backend/shared/ethercat/device-config-defaults'
import {
  applyScanReconciliation,
  parseScanResponse,
  reconcileScannedModules,
  type ScanResponse,
} from '../scan-reconcile'

const module_ = (
  slot: number,
  ident: string,
  over: Partial<ConfiguredEtherCATModule> = {},
): ConfiguredEtherCATModule => ({
  id: `slot-${slot}`,
  slot,
  name: `module ${slot}`,
  ident,
  esiModuleRef: { repositoryItemId: 'r', moduleIdent: ident },
  channelMappings: [],
  ...over,
})

const device = (modules?: ConfiguredEtherCATModule[]): ConfiguredEtherCATDevice => ({
  id: 'coupler',
  position: 1,
  name: 'coupler',
  esiDeviceRef: { repositoryItemId: 'r', deviceIndex: 0 },
  vendorId: '0x1',
  productCode: '0x1',
  revisionNo: '0x1',
  addedFrom: 'repository',
  config: createDefaultSlaveConfig(),
  channelMappings: [],
  modules,
})

describe('DOPE-704 E6: parseScanResponse', () => {
  test('well-formed reply round-trips the fields', () => {
    const raw = {
      slave_position: 1,
      modules: [
        { slot: 1, ident: '0x05421352' },
        { slot: 2, ident: '0x05421353' },
      ],
    }
    expect(parseScanResponse(raw)).toEqual<ScanResponse>({
      slavePosition: 1,
      modules: [
        { slot: 1, ident: '0x05421352' },
        { slot: 2, ident: '0x05421353' },
      ],
    })
  })

  test('idents are normalised to lower case', () => {
    const result = parseScanResponse({ slave_position: 1, modules: [{ slot: 1, ident: '0x05ABCDEF' }] })
    expect(result?.modules[0]?.ident).toBe('0x05abcdef')
  })

  test('out-of-order slots are sorted', () => {
    const result = parseScanResponse({
      slave_position: 1,
      modules: [
        { slot: 3, ident: '0x3' },
        { slot: 1, ident: '0x1' },
      ],
    })
    expect(result?.modules.map((m) => m.slot)).toEqual([1, 3])
  })

  test.each([
    null,
    undefined,
    'not an object',
    42,
    { slave_position: 0, modules: [] }, // slot < 1
    { slave_position: 1.5, modules: [] }, // not integer
    { slave_position: 1 }, // no modules array
    { slave_position: 1, modules: 'not array' },
    { slave_position: 1, modules: [{ slot: 1 }] }, // missing ident
    { slave_position: 1, modules: [{ slot: 1, ident: 'oops' }] }, // malformed ident
    { slave_position: 1, modules: [{ slot: 0, ident: '0x1' }] }, // slot 0
    {
      slave_position: 1,
      modules: [
        { slot: 1, ident: '0x1' },
        { slot: 1, ident: '0x2' },
      ],
    }, // duplicate slot
  ])('malformed input %# returns null', (input) => {
    expect(parseScanResponse(input)).toBeNull()
  })
})

describe('DOPE-704 E6: reconcileScannedModules', () => {
  test('empty bus + empty project → identical, no items', () => {
    const result = reconcileScannedModules({ slavePosition: 1, modules: [] }, [])
    expect(result).toEqual({ items: [], identical: true })
  })

  test('project matches scan exactly → all keep, identical=true', () => {
    const scan: ScanResponse = {
      slavePosition: 1,
      modules: [
        { slot: 1, ident: '0x1' },
        { slot: 2, ident: '0x2' },
      ],
    }
    const result = reconcileScannedModules(scan, [module_(1, '0x1'), module_(2, '0x2')])
    expect(result.identical).toBe(true)
    expect(result.items.map((i) => i.kind)).toEqual(['keep', 'keep'])
  })

  test('scan found a module the project does not have → add', () => {
    const result = reconcileScannedModules({ slavePosition: 1, modules: [{ slot: 1, ident: '0x1' }] }, [])
    expect(result.identical).toBe(false)
    expect(result.items).toEqual([{ kind: 'add', slot: 1, ident: '0x1' }])
  })

  test('scan did not find a module the project has → remove', () => {
    const result = reconcileScannedModules({ slavePosition: 1, modules: [] }, [module_(1, '0x1')])
    expect(result.items).toEqual([{ kind: 'remove', slot: 1, existingModuleId: 'slot-1', existingIdent: '0x1' }])
  })

  test('both sides filled with different idents → replace', () => {
    const result = reconcileScannedModules({ slavePosition: 1, modules: [{ slot: 1, ident: '0x2' }] }, [
      module_(1, '0x1'),
    ])
    expect(result.items).toEqual([
      { kind: 'replace', slot: 1, existingModuleId: 'slot-1', existingIdent: '0x1', scannedIdent: '0x2' },
    ])
  })

  test('ident case does not matter', () => {
    const result = reconcileScannedModules({ slavePosition: 1, modules: [{ slot: 1, ident: '0xabcd' }] }, [
      module_(1, '0xABCD'),
    ])
    expect(result.items[0]?.kind).toBe('keep')
  })

  test('empty slot (0x0) on both sides emits no item', () => {
    const result = reconcileScannedModules({ slavePosition: 1, modules: [{ slot: 2, ident: '0x0' }] }, [
      module_(1, '0x1'),
    ])
    // only slot 1 remove, slot 2 silent
    expect(result.items.map((i) => i.slot)).toEqual([1])
  })

  test('mixed diff lists items in slot order', () => {
    const result = reconcileScannedModules(
      {
        slavePosition: 1,
        modules: [
          { slot: 1, ident: '0x1' }, // keep
          { slot: 3, ident: '0x33' }, // replace
          { slot: 4, ident: '0x4' }, // add
        ],
      },
      [
        module_(1, '0x1'),
        module_(2, '0x2'), // remove
        module_(3, '0x3'),
      ],
    )
    expect(result.items.map((i) => `${i.slot}:${i.kind}`)).toEqual(['1:keep', '2:remove', '3:replace', '4:add'])
    expect(result.identical).toBe(false)
  })
})

describe('DOPE-704 E6: applyScanReconciliation', () => {
  test('keep-only reconciliation leaves modules verbatim', () => {
    const d = device([
      module_(1, '0x1', { name: 'operator-named', channelMappings: [{ channelId: 'c', iecLocation: '%IX0.0' }] }),
    ])
    const result = applyScanReconciliation(d, {
      items: [{ kind: 'keep', slot: 1, moduleId: 'slot-1', ident: '0x1' }],
      identical: true,
    })
    expect(result.modules?.[0]?.name).toBe('operator-named')
    expect(result.modules?.[0]?.channelMappings).toEqual([{ channelId: 'c', iecLocation: '%IX0.0' }])
  })

  test('add inserts a pending stub with slot-based id', () => {
    const result = applyScanReconciliation(device([]), {
      items: [{ kind: 'add', slot: 2, ident: '0x05421353' }],
      identical: false,
    })
    expect(result.modules).toEqual([
      {
        id: 'slot-2',
        slot: 2,
        name: '(pending — ident 0x05421353)',
        ident: '0x05421353',
        esiModuleRef: { repositoryItemId: '', moduleIdent: '0x05421353' },
        channelMappings: [],
      },
    ])
  })

  test('remove drops the matching slot', () => {
    const d = device([module_(1, '0x1'), module_(2, '0x2')])
    const result = applyScanReconciliation(d, {
      items: [
        { kind: 'keep', slot: 1, moduleId: 'slot-1', ident: '0x1' },
        { kind: 'remove', slot: 2, existingModuleId: 'slot-2', existingIdent: '0x2' },
      ],
      identical: false,
    })
    expect(result.modules?.map((m) => m.slot)).toEqual([1])
  })

  test('replace swaps the module for a pending stub (channel mappings cleared)', () => {
    const d = device([module_(1, '0x1', { channelMappings: [{ channelId: 'c', iecLocation: '%IX0.0' }] })])
    const result = applyScanReconciliation(d, {
      items: [{ kind: 'replace', slot: 1, existingModuleId: 'slot-1', existingIdent: '0x1', scannedIdent: '0x2' }],
      identical: false,
    })
    expect(result.modules?.[0]?.ident).toBe('0x2')
    expect(result.modules?.[0]?.channelMappings).toEqual([])
    expect(result.modules?.[0]?.name).toContain('pending')
  })

  test('an empty resulting module list leaves `modules` undefined', () => {
    const d = device([module_(1, '0x1')])
    const result = applyScanReconciliation(d, {
      items: [{ kind: 'remove', slot: 1, existingModuleId: 'slot-1', existingIdent: '0x1' }],
      identical: false,
    })
    expect(result.modules).toBeUndefined()
  })
})
