import { cleanup, fireEvent, render } from '@testing-library/react'

import type { OpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import type { BoardInfo } from '@root/middleware/shared/ports/types'

import { CreatePLCElement } from '..'

const vpp = (screens: Record<string, unknown>): BoardInfo['vpp'] => ({
  packageId: 'com.openplc.arduino',
  vendor: 'OpenPLC',
  deviceId: 'board',
  packagePath: '/packages/com.openplc.arduino',
  screens,
  moduleSystem: null,
})

const baremetal = (over: Partial<BoardInfo>): BoardInfo => ({
  compiler: 'arduino-cli',
  core: 'arduino:avr',
  preview: '',
  specs: {},
  ...over,
})

const UNO = baremetal({
  serialPorts: ['Serial'],
  defaultSerial: 'Serial',
  capabilities: { modbusTcpMaster: true },
  vpp: vpp({ Serial: {}, Network: {} }),
})
const UNO_Q = baremetal({ serialPorts: ['Serial'], defaultSerial: 'Serial', vpp: vpp({ Serial: {} }) })
const UNO_WITHOUT_TCP = baremetal({ serialPorts: ['Serial'], defaultSerial: 'Serial', vpp: vpp({ Serial: {} }) })
const MEGA_WITHOUT_TCP = baremetal({
  serialPorts: ['Serial', 'Serial1', 'Serial2', 'Serial3'],
  defaultSerial: 'Serial',
  vpp: vpp({ Serial: {}, Network: {} }),
})
const RUNTIME_V4: BoardInfo = { compiler: 'openplc-compiler', core: '', preview: '', specs: {} }
const RUNTIME_V3: BoardInfo = {
  compiler: 'openplc-compiler',
  core: '',
  preview: '',
  specs: {},
  capabilities: { modbusTcpMaster: false, modbusRtuMaster: false, ethercat: false },
}

let store: OpenPLCStore

/** Opens the "+" menu on `board` and reports whether it offers a Remote Device. */
const offersRemoteDevice = (name: string, board: BoardInfo): boolean => {
  store.getState().deviceActions.setAvailableOptions({ availableBoards: new Map([[name, board]]) })
  store.getState().deviceActions.setDeviceBoard(name)
  render(<CreatePLCElement />, { wrapper: createStoreWrapper(store) })
  fireEvent.click(document.getElementById('create-plc-element-trigger') as HTMLElement)
  if (!document.getElementById('create-function-trigger')) throw new Error('the create menu did not open')
  return document.querySelector('#create-remote-device-trigger, [data-testid="create-remote-device"]') !== null
}

beforeEach(() => {
  store = createTestStore()
})

afterEach(() => {
  cleanup()
})

describe('offering a Remote Device in the create menu (TC19)', () => {
  it.each([
    ['the Uno with the TCP opt-in', 'Arduino Uno', UNO],
    ['the Mega without the TCP opt-in, on its spare UARTs', 'Arduino Mega', MEGA_WITHOUT_TCP],
    ['Runtime v4', 'OpenPLC Runtime v4', RUNTIME_V4],
  ])('offers it on %s', (_target, name, board) => {
    expect(offersRemoteDevice(name, board)).toBe(true)
  })

  it.each([
    ['the Uno Q, with no network and no spare UART', 'Arduino Uno Q', UNO_Q],
    ['the Uno without the TCP opt-in', 'Arduino Uno', UNO_WITHOUT_TCP],
    ['Runtime v3', 'OpenPLC Runtime v3', RUNTIME_V3],
  ])('does not offer it on %s', (_target, name, board) => {
    expect(offersRemoteDevice(name, board)).toBe(false)
  })

  it('names the Remote Device entry for the end-to-end tests', () => {
    offersRemoteDevice('OpenPLC Runtime v4', RUNTIME_V4)
    expect(document.querySelector('[data-testid="create-remote-device"]')).not.toBeNull()
  })
})
