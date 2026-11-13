import { beforeEach, describe, expect, it } from '@jest/globals'

import type { BoardInfo, PLCRemoteDevice } from '../../../middleware/shared/ports/types'
import type { OpenPLCStore } from '../index'
import { createTestStore } from '../testing'

const RUNTIME_V4: BoardInfo = { compiler: 'openplc-compiler', core: '', preview: '', specs: {} }

/** Today's Mega package: no TCP master opt-in, three spare UARTs. */
const MEGA_RTU_ONLY: BoardInfo = {
  compiler: 'arduino-cli',
  core: 'arduino:avr',
  preview: '',
  specs: {},
  serialPorts: ['Serial', 'Serial1', 'Serial2', 'Serial3'],
  defaultSerial: 'Serial',
}

let store: OpenPLCStore

const selectBoard = (name: string, board: BoardInfo) => {
  store.getState().deviceActions.setAvailableOptions({ availableBoards: new Map([[name, board]]) })
  store.getState().deviceActions.setDeviceBoard(name)
}

const configOf = (name: string) =>
  (store.getState().project.data.remoteDevices ?? []).find((device) => device.name === name)?.modbusTcpConfig

/** Opens a project whose devices are exactly `devices`, as the loader hands them over. */
const openProjectWith = (devices: PLCRemoteDevice[]) => {
  const { project } = store.getState()
  store.getState().projectActions.setProject({ ...project, data: { ...project.data, remoteDevices: devices } })
}

const tcpDevice = (name: string, reconnect?: boolean): PLCRemoteDevice => ({
  name,
  protocol: 'modbus-tcp',
  modbusTcpConfig: {
    transport: 'tcp',
    host: '192.168.1.20',
    port: 502,
    slaveId: 1,
    timeout: 1000,
    ioGroups: [],
    ...(reconnect === undefined ? {} : { reconnect }),
  },
})

beforeEach(() => {
  store = createTestStore()
})

describe('creating a Modbus remote device (TC18)', () => {
  it('saves a new TCP device on Runtime v4 with Reconnect unchecked', () => {
    selectBoard('OpenPLC Runtime v4', RUNTIME_V4)

    expect(store.getState().remoteDeviceActions.create({ name: 'Pump', protocol: 'modbus-tcp' }).ok).toBe(true)

    expect(configOf('Pump')?.transport).toBe('tcp')
    expect(configOf('Pump')?.reconnect).toBe(false)
  })

  it('saves Reconnect unchecked through the project action as well', () => {
    selectBoard('OpenPLC Runtime v4', RUNTIME_V4)

    store.getState().projectActions.createRemoteDevice({ data: { name: 'Pump', protocol: 'modbus-tcp' } })

    expect(configOf('Pump')?.reconnect).toBe(false)
  })

  it('saves a new device on an RTU-only baremetal board on RTU, on its first spare UART, with Reconnect unchecked', () => {
    selectBoard('Arduino Mega', MEGA_RTU_ONLY)

    store.getState().remoteDeviceActions.create({ name: 'Drive', protocol: 'modbus-tcp' })

    expect(configOf('Drive')).toMatchObject({ transport: 'rtu', serialPort: 'Serial1', reconnect: false })
  })

  it('keeps Reconnect unchecked when an RTU device is switched to TCP', () => {
    selectBoard('Arduino Mega', MEGA_RTU_ONLY)
    store.getState().remoteDeviceActions.create({ name: 'Drive', protocol: 'modbus-tcp' })

    store.getState().projectActions.updateRemoteDeviceConfig('Drive', { transport: 'tcp' })

    expect(configOf('Drive')?.transport).toBe('tcp')
    expect(configOf('Drive')?.reconnect).toBe(false)
  })

  it('saves Reconnect unchecked even with no target selected', () => {
    store.getState().remoteDeviceActions.create({ name: 'Pump', protocol: 'modbus-tcp' })

    expect(configOf('Pump')?.reconnect).toBe(false)
  })

  it('gives an EtherCAT bus no Modbus configuration', () => {
    selectBoard('OpenPLC Runtime v4', RUNTIME_V4)

    store.getState().remoteDeviceActions.create({ name: 'Bus', protocol: 'ethercat' })

    expect(configOf('Bus')).toBeUndefined()
  })
})

describe('duplicating a Modbus remote device (TC18)', () => {
  it('keeps Reconnect checked on the copy of a device that has it checked', () => {
    selectBoard('OpenPLC Runtime v4', RUNTIME_V4)
    openProjectWith([tcpDevice('Pump', true)])

    expect(store.getState().remoteDeviceActions.duplicate('Pump', 'Pump_copy').ok).toBe(true)

    expect(configOf('Pump_copy')?.reconnect).toBe(true)
  })

  it('keeps Reconnect unchecked on the copy of a device that has it unchecked', () => {
    selectBoard('OpenPLC Runtime v4', RUNTIME_V4)
    openProjectWith([tcpDevice('Pump', false)])

    store.getState().remoteDeviceActions.duplicate('Pump', 'Pump_copy')

    expect(configOf('Pump_copy')?.reconnect).toBe(false)
  })
})

describe('editing Reconnect', () => {
  it('writes Reconnect checked', () => {
    openProjectWith([tcpDevice('Pump', false)])

    expect(store.getState().projectActions.updateRemoteDeviceConfig('Pump', { reconnect: true }).ok).toBe(true)

    expect(configOf('Pump')?.reconnect).toBe(true)
  })

  it('writes Reconnect unchecked', () => {
    openProjectWith([tcpDevice('Pump')])

    store.getState().projectActions.updateRemoteDeviceConfig('Pump', { reconnect: false })

    expect(configOf('Pump')?.reconnect).toBe(false)
  })

  it('leaves Reconnect alone when another field is edited', () => {
    openProjectWith([tcpDevice('Pump', true)])

    store.getState().projectActions.updateRemoteDeviceConfig('Pump', { host: '10.0.0.9' })

    expect(configOf('Pump')?.reconnect).toBe(true)
  })
})

describe('opening a project saved before Reconnect existed (TC12)', () => {
  it('leaves the key absent on open, so the device resolves to checked', () => {
    openProjectWith([tcpDevice('Pump')])
    selectBoard('OpenPLC Runtime v4', RUNTIME_V4)

    expect(Object.keys(configOf('Pump') ?? {})).not.toContain('reconnect')
  })
})
