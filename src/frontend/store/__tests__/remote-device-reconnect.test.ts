import { beforeEach, describe, expect, it } from '@jest/globals'

import type { BoardInfo, PLCRemoteDevice } from '../../../middleware/shared/ports/types'
import { buildAllProjectFileContentsPure } from '../../services/save-actions'
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

/** A TCP device saved before `transport` existed: no transport key and no Reconnect key. */
const untypedTcpDevice = (name: string): PLCRemoteDevice => ({
  name,
  protocol: 'modbus-tcp',
  modbusTcpConfig: { host: '192.168.1.20', port: 502, slaveId: 1, timeout: 1000, ioGroups: [] },
})

const rtuDevice = (name: string, reconnect?: boolean): PLCRemoteDevice => ({
  name,
  protocol: 'modbus-tcp',
  modbusTcpConfig: {
    transport: 'rtu',
    serialPort: 'Serial1',
    baudRate: 9600,
    parity: 'N',
    stopBits: 1,
    dataBits: 8,
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

describe('editing an older device writes the Reconnect it shows (TC12)', () => {
  it.each([
    ['the Timeout', { timeout: 900 }],
    ['the host', { host: '10.0.0.9' }],
    ['the port', { port: 1502 }],
    ['the slave id', { slaveId: 7 }],
  ])('writes Reconnect checked on an older TCP device when %s is edited', (_field, edit) => {
    openProjectWith([tcpDevice('Gateway')])

    store.getState().projectActions.updateRemoteDeviceConfig('Gateway', edit)

    expect(configOf('Gateway')).toMatchObject({ ...edit, reconnect: true })
  })

  it('writes Reconnect checked on an older device saved with no transport', () => {
    openProjectWith([untypedTcpDevice('Gateway')])

    store.getState().projectActions.updateRemoteDeviceConfig('Gateway', { timeout: 900 })

    expect(configOf('Gateway')).toMatchObject({ timeout: 900, reconnect: true })
  })

  it('writes no Reconnect on an older RTU device', () => {
    openProjectWith([rtuDevice('Drive')])

    store.getState().projectActions.updateRemoteDeviceConfig('Drive', { baudRate: 19200 })

    expect(configOf('Drive')?.baudRate).toBe(19200)
    expect(Object.keys(configOf('Drive') ?? {})).not.toContain('reconnect')
  })

  it('writes Reconnect checked when an older RTU device is switched to TCP', () => {
    openProjectWith([rtuDevice('Drive')])

    store.getState().projectActions.updateRemoteDeviceConfig('Drive', { transport: 'tcp' })

    expect(configOf('Drive')).toMatchObject({ transport: 'tcp', reconnect: true })
  })

  it.each([
    ['a TCP device saved unchecked', tcpDevice('Gateway', false), { timeout: 900 }, false],
    ['a TCP device saved checked', tcpDevice('Gateway', true), { timeout: 900 }, true],
    [
      'an RTU device saved unchecked and switched to TCP',
      rtuDevice('Gateway', false),
      { transport: 'tcp' as const },
      false,
    ],
  ])('keeps the saved Reconnect of %s', (_device, device, edit, saved) => {
    openProjectWith([device])

    store.getState().projectActions.updateRemoteDeviceConfig('Gateway', edit)

    expect(configOf('Gateway')?.reconnect).toBe(saved)
  })

  it('writes the Reconnect a call gives on an older TCP device', () => {
    openProjectWith([tcpDevice('Gateway')])

    store.getState().projectActions.updateRemoteDeviceConfig('Gateway', { timeout: 900, reconnect: false })

    expect(configOf('Gateway')).toMatchObject({ timeout: 900, reconnect: false })
  })

  it('leaves a device with no Modbus configuration untouched', () => {
    const bus: PLCRemoteDevice = { name: 'Bus', protocol: 'ethercat' }
    openProjectWith([bus])

    store.getState().projectActions.updateRemoteDeviceConfig('Bus', { timeout: 900 })

    expect(store.getState().project.data.remoteDevices).toEqual([bus])
  })

  it('answers ok for the edit of an older TCP device', () => {
    openProjectWith([tcpDevice('Gateway')])

    expect(store.getState().projectActions.updateRemoteDeviceConfig('Gateway', { timeout: 900 }).ok).toBe(true)
  })

  it('saves Reconnect checked to the device file of an older TCP device after an edit', () => {
    openProjectWith([tcpDevice('Gateway')])

    store.getState().projectActions.updateRemoteDeviceConfig('Gateway', { timeout: 900 })

    const saved: unknown = JSON.parse(buildAllProjectFileContentsPure(store)['devices/remote/Gateway.json'])
    expect(saved).toMatchObject({ modbusTcpConfig: { timeout: 900, reconnect: true } })
  })
})
