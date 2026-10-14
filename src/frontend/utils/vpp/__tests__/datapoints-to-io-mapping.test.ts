import { UR20_16DI_16DO } from '@root/__fixtures__/device-editor-datapoints/ur20-16di-16do'
import { UR20_2DI_P_TS } from '@root/__fixtures__/device-editor-datapoints/ur20-2di-p-ts'
import type { IoMappingEntry } from '@root/middleware/shared/ports/types'
import { buildAddressPool } from '@root/middleware/shared/utils/iec-address/address-pool'
import { RUNTIME_V4_CAPABILITIES } from '@root/middleware/shared/utils/target-capabilities'
import type { DataPoint } from '@root/middleware/shared/vendor-document/protocol'

import {
  datapointsToIoMapping,
  type DeviceSetupRecord,
  restoreAliasesByDatapointId,
  toDeviceSetupRecord,
} from '../datapoints-to-io-mapping'

const emptyPool = buildAddressPool({}, RUNTIME_V4_CAPABILITIES)

const dataPoint = (overrides: Partial<DataPoint> & Pick<DataPoint, 'id'>): DataPoint => ({
  name: overrides.id,
  min: '0',
  max: '0',
  datatype: 'BOOL',
  byteoffset: 0,
  bitoffset: 0,
  bitlength: 1,
  access: 'ro',
  ...overrides,
})

const singleModule: DeviceSetupRecord = {
  modules: [{ guid: 'g1', instanceName: 'MOD_1', typeId: 'T1', slot: 1 }],
}

const prefixCounts = (entries: readonly IoMappingEntry[]): Record<string, number> => {
  const counts: Record<string, number> = {}
  for (const entry of entries) {
    const prefix = /^%[IQM][XBWDL]/.exec(entry.iecAddress)?.[0] ?? entry.iecAddress
    counts[prefix] = (counts[prefix] ?? 0) + 1
  }
  return counts
}

describe('toDeviceSetupRecord', () => {
  it('numbers modules by bus position and keeps guid, name and type', () => {
    expect(toDeviceSetupRecord(UR20_16DI_16DO.deviceSetup).modules).toEqual([
      { guid: 'ff97f8f1-d407-468d-d498-395ace2847f8', instanceName: 'UR20_16DI_P_1', typeId: '00049fc2', slot: 1 },
      { guid: 'b1a5b668-9bb2-4ecc-e0ae-ee660206e77f', instanceName: 'UR20_16DO_P_1', typeId: '0103afd0', slot: 2 },
    ])
  })
})

describe('datapointsToIoMapping', () => {
  it('maps a UR20-2DI-P-TS to 45 channels: 30 %IB and 15 %IW', () => {
    const { entries, unaddressable } = datapointsToIoMapping(
      UR20_2DI_P_TS.dataPoints,
      toDeviceSetupRecord(UR20_2DI_P_TS.deviceSetup),
      emptyPool,
    )

    expect(unaddressable).toEqual([])
    expect(entries).toHaveLength(45)
    expect(prefixCounts(entries)).toEqual({ '%IB': 30, '%IW': 15 })
    expect(entries[0]).toEqual({
      slot: 1,
      moduleId: '0f014700',
      moduleName: 'UR20_2DI_P_TS_1',
      channelName: 'UR20_2DI_P_TS_1_input_image_1',
      channelType: 'UInt8',
      dataType: 'USINT',
      iecAddress: '%IB0',
      alias: '',
      datapointId: '79c36d77-2861-4921-f3cc-97ff6cb77e89_0',
    })
    expect(entries[2]).toMatchObject({ iecAddress: '%IW0', dataType: 'UINT' })
    expect(entries.at(-1)).toMatchObject({
      iecAddress: '%IW14',
      datapointId: '79c36d77-2861-4921-f3cc-97ff6cb77e89_44',
    })
  })

  it('maps read-only BOOLs to %IX and write-only BOOLs to %QX, per module slot', () => {
    const { entries } = datapointsToIoMapping(
      UR20_16DI_16DO.dataPoints,
      toDeviceSetupRecord(UR20_16DI_16DO.deviceSetup),
      emptyPool,
    )

    expect(prefixCounts(entries)).toEqual({ '%IX': 16, '%QX': 16 })
    expect(entries[0]).toMatchObject({ slot: 1, moduleName: 'UR20_16DI_P_1', iecAddress: '%IX0.0', dataType: 'BOOL' })
    expect(entries[15]).toMatchObject({ slot: 1, iecAddress: '%IX1.7' })
    expect(entries[16]).toMatchObject({ slot: 2, moduleName: 'UR20_16DO_P_1', iecAddress: '%QX0.0' })
  })

  it('expands a Bitarea of n bits into n bit channels with bit-suffixed ids', () => {
    const { entries } = datapointsToIoMapping(
      [dataPoint({ id: 'g1_0', name: 'DI', datatype: 'Bitarea', bitlength: 4 })],
      singleModule,
      emptyPool,
    )

    expect(entries.map((entry) => [entry.datapointId, entry.channelName, entry.iecAddress])).toEqual([
      ['g1_0_0', 'DI.0', '%IX0.0'],
      ['g1_0_1', 'DI.1', '%IX0.1'],
      ['g1_0_2', 'DI.2', '%IX0.2'],
      ['g1_0_3', 'DI.3', '%IX0.3'],
    ])
    expect(entries.every((entry) => entry.dataType === 'BOOL' && entry.channelType === 'Bitarea')).toBe(true)
  })

  it('accepts datapoint ids with and without a bit suffix', () => {
    const { entries, unaddressable } = datapointsToIoMapping(
      [dataPoint({ id: 'g1_3' }), dataPoint({ id: 'g1_4_2', bitoffset: 2 })],
      singleModule,
      emptyPool,
    )

    expect(unaddressable).toEqual([])
    expect(entries.map((entry) => entry.datapointId)).toEqual(['g1_3', 'g1_4_2'])
  })

  it('maps 8/16/32-bit widths to B/W/D and keeps IEC datatype names', () => {
    const { entries } = datapointsToIoMapping(
      [
        dataPoint({ id: 'g1_0', datatype: 'SINT', bitlength: 8, access: 'wo' }),
        dataPoint({ id: 'g1_1', datatype: 'INT', bitlength: 16 }),
        dataPoint({ id: 'g1_2', datatype: 'DINT', bitlength: 32, access: 'wo' }),
        dataPoint({ id: 'g1_3', datatype: 'Int16', bitlength: 16 }),
      ],
      singleModule,
      emptyPool,
    )

    expect(entries.map((entry) => [entry.iecAddress, entry.dataType])).toEqual([
      ['%QB0', 'SINT'],
      ['%IW0', 'INT'],
      ['%QD0', 'DINT'],
      ['%IW1', 'INT'],
    ])
  })

  it('reports REAL, 64-bit, unknown access and foreign datapoints instead of mapping them', () => {
    const { entries, unaddressable } = datapointsToIoMapping(
      [
        dataPoint({ id: 'g1_0', name: 'real', datatype: 'REAL', bitlength: 32 }),
        dataPoint({ id: 'g1_1', name: 'wide', datatype: 'UInt64', bitlength: 64 }),
        dataPoint({ id: 'g1_2', name: 'rw', access: 'rw' }),
        dataPoint({ id: 'g1_3', name: 'none', access: undefined }),
        dataPoint({ id: 'other_0', name: 'foreign' }),
        dataPoint({ id: 'g1_4', name: 'odd', bitlength: 12, datatype: 'UInt12' }),
      ],
      singleModule,
      emptyPool,
    )

    expect(entries).toEqual([])
    expect(unaddressable).toEqual([
      { datapointId: 'g1_0', name: 'real', reason: 'unsupported-datatype' },
      { datapointId: 'g1_1', name: 'wide', reason: 'unsupported-width' },
      { datapointId: 'g1_2', name: 'rw', reason: 'unsupported-access' },
      { datapointId: 'g1_3', name: 'none', reason: 'unsupported-access' },
      { datapointId: 'other_0', name: 'foreign', reason: 'unknown-module' },
      { datapointId: 'g1_4', name: 'odd', reason: 'unsupported-width' },
    ])
  })

  it('never produces %IL or %QL', () => {
    const { entries } = datapointsToIoMapping(
      [
        dataPoint({ id: 'g1_0', datatype: 'LINT', bitlength: 64 }),
        dataPoint({ id: 'g1_1', datatype: 'ULINT', bitlength: 64, access: 'wo' }),
      ],
      singleModule,
      emptyPool,
    )

    expect(entries).toEqual([])
  })

  it('allocates around addresses other producers already hold', () => {
    const pool = buildAddressPool(
      { pinMapping: { pins: [{ address: '%IB0' }, { address: '%IX0.0' }] } },
      { ...RUNTIME_V4_CAPABILITIES, pinMapping: true },
    )
    const { entries } = datapointsToIoMapping(
      [dataPoint({ id: 'g1_0', datatype: 'UInt8', bitlength: 8 }), dataPoint({ id: 'g1_1' })],
      singleModule,
      pool,
    )

    expect(entries.map((entry) => entry.iecAddress)).toEqual(['%IB1', '%IX0.1'])
  })

  it('keeps same-named modules apart by guid', () => {
    const setup: DeviceSetupRecord = {
      modules: [
        { guid: 'a', instanceName: 'DUP', typeId: 'T', slot: 1 },
        { guid: 'b', instanceName: 'DUP', typeId: 'T', slot: 2 },
      ],
    }
    const { entries } = datapointsToIoMapping(
      [dataPoint({ id: 'a_0', name: 'DUP_DI_0' }), dataPoint({ id: 'b_0', name: 'DUP_DI_0' })],
      setup,
      emptyPool,
    )

    expect(entries.map((entry) => [entry.slot, entry.datapointId, entry.iecAddress])).toEqual([
      [1, 'a_0', '%IX0.0'],
      [2, 'b_0', '%IX0.1'],
    ])
  })
})

describe('restoreAliasesByDatapointId', () => {
  const entry = (datapointId: string | undefined, alias = '', channelName = 'ch'): IoMappingEntry => ({
    slot: 1,
    moduleId: 'T',
    moduleName: 'MOD_1',
    channelName,
    channelType: 'BOOL',
    dataType: 'BOOL',
    iecAddress: '%IX0.0',
    alias,
    datapointId,
  })

  it('carries aliases onto entries with the same datapoint id', () => {
    const { entries, dropped } = restoreAliasesByDatapointId(
      [entry('g1_0', 'start'), entry('g1_1', '')],
      [entry('g1_1'), entry('g1_0')],
    )

    expect(entries.map((e) => [e.datapointId, e.alias])).toEqual([
      ['g1_1', ''],
      ['g1_0', 'start'],
    ])
    expect(dropped).toEqual([])
  })

  it('drops the aliases of a module re-added under a new guid', () => {
    const { entries, dropped } = restoreAliasesByDatapointId(
      [entry('old_0', 'start', 'MOD_1_DI_0')],
      [entry('new_0', '', 'MOD_1_DI_0')],
    )

    expect(entries[0].alias).toBe('')
    expect(dropped).toEqual([{ alias: 'start', datapointId: 'old_0', channelName: 'MOD_1_DI_0' }])
  })

  it('ignores entries without a datapoint id', () => {
    const { entries, dropped } = restoreAliasesByDatapointId([entry(undefined, 'legacy')], [entry(undefined)])

    expect(entries[0].alias).toBe('')
    expect(dropped).toEqual([])
  })
})
