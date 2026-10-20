/**
 * Fixture: a Delta ASDA-A2-E-style multi-mode drive with per-slave PDO assignment,
 * PDO mapping rewrite, slave-level InitCmd ordering and user startup SDOs enabled.
 */

import type { PLCRemoteDevice } from '@root/backend/shared/types/PLC/open-plc'
import type { ConfiguredEtherCATDevice } from '@root/middleware/shared/ports/esi-types'

import { createDefaultSlaveConfig } from '../../device-config-defaults'

const drive: ConfiguredEtherCATDevice = {
  id: 'drive-1',
  position: 1,
  name: 'Drive1',
  esiDeviceRef: { repositoryItemId: 'delta-esi', deviceIndex: 0 },
  vendorId: '0x0000477F',
  productCode: '0x00000001',
  revisionNo: '0x00010001',
  addedFrom: 'repository',
  slaveType: 'analog_io',
  config: {
    ...createDefaultSlaveConfig(),
    coeFlags: { pdoAssign: true, pdoConfig: true, completeAccess: false },
  },
  channelMappings: [
    { channelId: '0x1A00-0x6041-0x00', iecLocation: '%IW0', alias: 'StatusWord' },
    { channelId: '0x1600-0x6040-0x00', iecLocation: '%QW0', alias: 'ControlWord' },
  ],
  channelInfo: [
    {
      channelId: '0x1A00-0x6041-0x00',
      name: 'StatusWord',
      direction: 'input',
      pdoIndex: '0x1A00',
      entryIndex: '0x6041',
      entrySubIndex: '0x00',
      dataType: 'UINT16',
      bitLen: 16,
      iecType: 'UINT',
    },
    {
      channelId: '0x1600-0x6040-0x00',
      name: 'ControlWord',
      direction: 'output',
      pdoIndex: '0x1600',
      entryIndex: '0x6040',
      entrySubIndex: '0x00',
      dataType: 'UINT16',
      bitLen: 16,
      iecType: 'UINT',
    },
  ],
  rxPdos: [
    {
      index: '0x1600',
      name: 'CSP mode',
      assigned: true,
      sm: 2,
      entries: [{ index: '0x6040', subIndex: '0x00', bitLen: 16, name: 'ControlWord', dataType: 'UINT16' }],
    },
    {
      index: '0x1601',
      name: 'CSV mode',
      assigned: false,
      sm: 2,
      entries: [{ index: '0x6040', subIndex: '0x00', bitLen: 16, name: 'ControlWord', dataType: 'UINT16' }],
    },
  ],
  txPdos: [
    {
      index: '0x1A00',
      name: 'Status',
      assigned: true,
      sm: 3,
      entries: [{ index: '0x6041', subIndex: '0x00', bitLen: 16, name: 'StatusWord', dataType: 'UINT16' }],
    },
  ],
  esiInitCmdSdos: [
    {
      index: '0x6060',
      subIndex: 0,
      value: '8',
      defaultValue: '0',
      dataType: 'USINT',
      bitLength: 8,
      name: 'Mode of operation = CSP',
      objectName: 'ESI InitCmd',
    },
  ],
  sdoConfigurations: [
    {
      index: '0x6098',
      subIndex: 0,
      value: '1',
      defaultValue: '0',
      dataType: 'USINT',
      bitLength: 8,
      name: 'Homing method',
      objectName: 'User Startup Parameter',
    },
  ],
}

export const deltaMultiModeProject: PLCRemoteDevice[] = [
  {
    name: 'bus_a',
    protocol: 'ethercat',
    ethercatConfig: {
      masterConfig: { enabled: true, networkInterface: 'eth0', cycleTimeUs: 1000 },
      devices: [drive],
    },
  },
] as unknown as PLCRemoteDevice[]
