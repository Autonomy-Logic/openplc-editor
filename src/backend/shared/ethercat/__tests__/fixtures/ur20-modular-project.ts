/**
 * Fixture: a UR20-style modular coupler with one plain digital-input module and one
 * digital-output module.  Exercises module channels in iomapping, 0xF030 module-ident
 * writes, module startup SDOs, and PDO assignment on a modular station.
 */

import type { PLCRemoteDevice } from '@root/backend/shared/types/PLC/open-plc'
import type { ConfiguredEtherCATDevice, ConfiguredEtherCATModule } from '@root/middleware/shared/ports/esi-types'

import { createDefaultSlaveConfig } from '../../device-config-defaults'

const inputModule: ConfiguredEtherCATModule = {
  id: 'slot-1',
  slot: 1,
  name: 'UR20-4DI-P',
  ident: '0x00001a0f',
  esiModuleRef: { repositoryItemId: 'ur20-esi', moduleIdent: '0x00001a0f' },
  channelMappings: [
    { channelId: '0x1A00-0x6000-0x01', iecLocation: '%IX8.0', alias: 'DI_1' },
    { channelId: '0x1A00-0x6000-0x02', iecLocation: '%IX8.1', alias: 'DI_2' },
  ],
  channelInfo: [
    {
      channelId: '0x1A00-0x6000-0x01',
      name: 'DI 1',
      direction: 'input',
      pdoIndex: '0x1A00',
      entryIndex: '0x6000',
      entrySubIndex: '0x01',
      dataType: 'BOOL',
      bitLen: 1,
      iecType: 'BOOL',
    },
    {
      channelId: '0x1A00-0x6000-0x02',
      name: 'DI 2',
      direction: 'input',
      pdoIndex: '0x1A00',
      entryIndex: '0x6000',
      entrySubIndex: '0x02',
      dataType: 'BOOL',
      bitLen: 1,
      iecType: 'BOOL',
    },
  ],
  txPdos: [
    {
      index: '0x1A00',
      name: 'Slot 1 TxPDO',
      assigned: true,
      entries: [
        { index: '0x6000', subIndex: '0x01', bitLen: 1, name: 'DI 1', dataType: 'BOOL' },
        { index: '0x6000', subIndex: '0x02', bitLen: 1, name: 'DI 2', dataType: 'BOOL' },
      ],
    },
  ],
}

const outputModule: ConfiguredEtherCATModule = {
  id: 'slot-2',
  slot: 2,
  name: 'UR20-4DO-P',
  ident: '0x00001a10',
  esiModuleRef: { repositoryItemId: 'ur20-esi', moduleIdent: '0x00001a10' },
  channelMappings: [{ channelId: '0x1601-0x7000-0x01', iecLocation: '%QX0.0', alias: 'DO_1' }],
  channelInfo: [
    {
      channelId: '0x1601-0x7000-0x01',
      name: 'DO 1',
      direction: 'output',
      pdoIndex: '0x1601',
      entryIndex: '0x7000',
      entrySubIndex: '0x01',
      dataType: 'BOOL',
      bitLen: 1,
      iecType: 'BOOL',
    },
  ],
  rxPdos: [
    {
      index: '0x1601',
      name: 'Slot 2 RxPDO',
      assigned: true,
      entries: [{ index: '0x7000', subIndex: '0x01', bitLen: 1, name: 'DO 1', dataType: 'BOOL' }],
    },
  ],
}

const coupler: ConfiguredEtherCATDevice = {
  id: 'ur20-coupler',
  position: 1,
  name: 'UR20_Coupler',
  esiDeviceRef: { repositoryItemId: 'ur20-esi', deviceIndex: 0 },
  vendorId: '0x00000230',
  productCode: '0x04A41A86',
  revisionNo: '0x00060101',
  addedFrom: 'repository',
  slaveType: 'coupler',
  isModularCoupler: true,
  config: {
    ...createDefaultSlaveConfig(),
    coeFlags: { pdoAssign: false, pdoConfig: true, completeAccess: false },
  },
  channelMappings: [],
  channelInfo: [],
  modules: [inputModule, outputModule],
}

export const ur20ModularProject: PLCRemoteDevice[] = [
  {
    name: 'bus_a',
    protocol: 'ethercat',
    ethercatConfig: {
      masterConfig: { enabled: true, networkInterface: 'eth0', cycleTimeUs: 1000 },
      devices: [coupler],
    },
  },
] as unknown as PLCRemoteDevice[]
