import { beforeEach, describe, expect, it } from '@jest/globals'
import type { OpenPLCStore } from '@root/frontend/store'
import { createTestStore } from '@root/frontend/store/testing'
import type { IoMappingEntry } from '@root/middleware/shared/ports/types'

import { UR20_2DI_P_TS } from '../../../__fixtures__/device-editor-datapoints/ur20-2di-p-ts'
import { UR20_16DI_16DO } from '../../../__fixtures__/device-editor-datapoints/ur20-16di-16do'
import { applyConfiguratorSnapshot } from '../apply-configurator-snapshot'

const TARGET = { configuratorKey: 'configurator', controller: 'UC20-M3000', bundleVersion: '3.5.22' }

let store: OpenPLCStore

function vendorScreenData(): Record<string, unknown> {
  return store.getState().deviceDefinitions.configuration.vendorScreenData ?? {}
}

function ioEntries(): IoMappingEntry[] {
  const mapping = vendorScreenData()['io-mapping']
  return mapping && typeof mapping === 'object' && 'entries' in mapping && Array.isArray(mapping.entries)
    ? mapping.entries.filter((entry): entry is IoMappingEntry => !!entry && typeof entry === 'object')
    : []
}

function setAlias(datapointId: string, alias: string) {
  const entries = ioEntries().map((entry) => (entry.datapointId === datapointId ? { ...entry, alias } : entry))
  store.getState().deviceActions.setVendorScreenData('io-mapping', { entries })
}

describe('applyConfiguratorSnapshot', () => {
  beforeEach(() => {
    store = createTestStore()
  })

  it('stores the archive untouched next to the device setup and the derived mapping', () => {
    const archive = '1f8b0800\u0000ÿ' + 'ab'.repeat(5_000)
    applyConfiguratorSnapshot(store, TARGET, { archive, ...UR20_16DI_16DO })

    expect(vendorScreenData().configurator).toEqual({ archive, controller: 'UC20-M3000', bundleVersion: '3.5.22' })
    expect(vendorScreenData()['device-setup']).toEqual({
      modules: [
        {
          guid: UR20_16DI_16DO.deviceSetup.devices[0].guid,
          instanceName: 'UR20_16DI_P_1',
          typeId: expect.any(String),
          slot: 1,
        },
        {
          guid: UR20_16DI_16DO.deviceSetup.devices[1].guid,
          instanceName: 'UR20_16DO_P_1',
          typeId: '0103afd0',
          slot: 2,
        },
      ],
    })
    const addresses = ioEntries().map((entry) => entry.iecAddress)
    expect(addresses.filter((a) => a.startsWith('%IX'))).toHaveLength(16)
    expect(addresses.filter((a) => a.startsWith('%QX'))).toHaveLength(16)
    expect(new Set(addresses).size).toBe(32)
  })

  it('writes archive, device setup and mapping in one store update', () => {
    let updates = 0
    const unsubscribe = store.subscribe(() => {
      updates += 1
    })
    store.getState().deviceActions.setConfiguratorSnapshot('configurator', {
      configurator: { archive: 'a', controller: 'c', bundleVersion: 'v' },
      deviceSetup: { modules: [] },
      ioMapping: { entries: [], unaddressable: [] },
    })
    unsubscribe()

    expect(updates).toBe(1)
  })

  it('carries an alias over by datapoint id when the configuration changes', () => {
    applyConfiguratorSnapshot(store, TARGET, { archive: 'one', ...UR20_16DI_16DO })
    const keptId = UR20_16DI_16DO.dataPoints[3].id
    setAlias(keptId, 'Pump_Run')

    const withSecondModule = {
      deviceSetup: {
        ...UR20_16DI_16DO.deviceSetup,
        devices: [...UR20_16DI_16DO.deviceSetup.devices, ...UR20_2DI_P_TS.deviceSetup.devices],
      },
      dataPoints: [...UR20_16DI_16DO.dataPoints, ...UR20_2DI_P_TS.dataPoints],
    }
    const applied = applyConfiguratorSnapshot(store, TARGET, { archive: 'two', ...withSecondModule })

    expect(applied.dropped).toEqual([])
    expect(ioEntries().find((entry) => entry.datapointId === keptId)?.alias).toBe('Pump_Run')
  })

  it('reports an alias whose datapoint is gone', () => {
    applyConfiguratorSnapshot(store, TARGET, { archive: 'one', ...UR20_16DI_16DO })
    const goneId = UR20_16DI_16DO.dataPoints[0].id
    setAlias(goneId, 'Gone_Input')

    const applied = applyConfiguratorSnapshot(store, TARGET, { archive: 'two', ...UR20_2DI_P_TS })

    expect(applied.dropped).toEqual([expect.objectContaining({ alias: 'Gone_Input', datapointId: goneId })])
    expect(ioEntries().some((entry) => entry.alias === 'Gone_Input')).toBe(false)
  })

  it('returns datapoints it could not address instead of dropping them silently', () => {
    const [first] = UR20_2DI_P_TS.dataPoints
    const applied = applyConfiguratorSnapshot(store, TARGET, {
      archive: 'one',
      deviceSetup: UR20_2DI_P_TS.deviceSetup,
      dataPoints: [{ ...first, access: 'rw' }],
    })

    expect(applied.unaddressable).toEqual([{ datapointId: first.id, name: first.name, reason: 'unsupported-access' }])
  })
})
