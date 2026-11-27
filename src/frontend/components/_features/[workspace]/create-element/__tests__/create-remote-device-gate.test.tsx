import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import type { OpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import type { BoardInfo } from '@root/middleware/shared/ports/types'

import { CreatePLCElement } from '..'
import { ElementCard } from '../element-card'

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
const MEGA_WITH_TCP = baremetal({
  serialPorts: ['Serial', 'Serial1', 'Serial2', 'Serial3'],
  defaultSerial: 'Serial',
  capabilities: { modbusTcpMaster: true },
  vpp: vpp({ Serial: {}, Network: {} }),
})
const RUNTIME_V4: BoardInfo = { compiler: 'openplc-compiler', core: '', preview: '', specs: {} }
const SIMULATOR: BoardInfo = { compiler: 'simulator', core: '', preview: '', specs: {} }
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

describe('the Remote Device card (TC18, TC19)', () => {
  const UNAVAILABLE = 'Remote devices are not available on the current target.'

  const selectBoard = (name: string, board: BoardInfo) => {
    store.getState().deviceActions.setAvailableOptions({ availableBoards: new Map([[name, board]]) })
    store.getState().deviceActions.setDeviceBoard(name)
  }

  const openRemoteDeviceCard = (name: string, board: BoardInfo): HTMLElement => {
    if (!offersRemoteDevice(name, board)) throw new Error(`the create menu does not offer a Remote Device on ${name}`)
    fireEvent.mouseEnter(screen.getByTestId('create-remote-device'))
    const card = document.getElementById('create-remote-device-content')
    if (!card) throw new Error('the Remote Device card did not open')
    return card
  }

  const protocolOptions = (card: HTMLElement): Map<string, HTMLElement> => {
    fireEvent.keyDown(within(card).getByLabelText('remote-device-protocol'), { key: 'Enter' })
    return new Map(screen.getAllByRole('option').map((option) => [(option.textContent ?? '').trim(), option]))
  }

  const isOptionDisabled = (option: HTMLElement | undefined) => {
    if (!option) throw new Error('the protocol is not listed')
    return option.getAttribute('aria-disabled') === 'true' || option.hasAttribute('data-disabled')
  }

  const configOf = (name: string) =>
    (store.getState().project.data.remoteDevices ?? []).find((device) => device.name === name)?.modbusTcpConfig

  const createModbusDevice = (card: HTMLElement, name: string) => {
    const nameInput = card.querySelector<HTMLInputElement>('#remote-device-name')
    if (!nameInput) throw new Error('the Remote Device card has no name field')
    fireEvent.change(nameInput, { target: { value: name } })
    const modbus = protocolOptions(card).get('Modbus')
    if (!modbus) throw new Error('the protocol picker does not list Modbus')
    fireEvent.click(modbus)
    fireEvent.click(within(card).getByRole('button', { name: 'Create' }))
  }

  const BAREMETAL_TARGETS = [
    ['the Mega without the TCP opt-in', 'Arduino Mega', MEGA_WITHOUT_TCP],
    ['the Mega with the TCP opt-in', 'Arduino Mega', MEGA_WITH_TCP],
    ['the Uno with the TCP opt-in', 'Arduino Uno', UNO],
  ] as const

  it.each(BAREMETAL_TARGETS)('shows the creation form on %s', (_target, name, board) => {
    const card = openRemoteDeviceCard(name, board)

    expect(card.querySelector('#remote-device-name')).not.toBeNull()
    expect(within(card).getByLabelText('remote-device-protocol')).toBeTruthy()
    expect(within(card).getByRole('button', { name: 'Cancel' })).toBeTruthy()
    expect(within(card).getByRole('button', { name: 'Create' })).toBeTruthy()
  })

  it.each(BAREMETAL_TARGETS)('does not send %s to OpenPLC Runtime v4', (_target, name, board) => {
    const card = openRemoteDeviceCard(name, board)

    expect(card.textContent).not.toContain('only available for OpenPLC Runtime v4')
  })

  it.each(BAREMETAL_TARGETS)('offers Modbus and not EtherCAT on %s', (_target, name, board) => {
    const options = protocolOptions(openRemoteDeviceCard(name, board))

    expect(isOptionDisabled(options.get('Modbus'))).toBe(false)
    expect(isOptionDisabled(options.get('EtherCAT'))).toBe(true)
  })

  it.each([
    ['Runtime v4', 'OpenPLC Runtime v4', RUNTIME_V4],
    ['the Simulator', 'OpenPLC Simulator', SIMULATOR],
  ])('shows the form with Modbus and EtherCAT offered on %s', (_target, name, board) => {
    const card = openRemoteDeviceCard(name, board)
    expect(card.querySelector('#remote-device-name')).not.toBeNull()

    const options = protocolOptions(card)
    expect(isOptionDisabled(options.get('Modbus'))).toBe(false)
    expect(isOptionDisabled(options.get('EtherCAT'))).toBe(false)
  })

  it.each([
    ['Runtime v4', 'OpenPLC Runtime v4', RUNTIME_V4],
    ['the Mega', 'Arduino Mega', MEGA_WITH_TCP],
  ])('keeps EtherNet/IP and PROFINET listed and disabled on %s', (_target, name, board) => {
    const options = protocolOptions(openRemoteDeviceCard(name, board))

    expect(isOptionDisabled(options.get('EtherNet/IP'))).toBe(true)
    expect(isOptionDisabled(options.get('PROFINET'))).toBe(true)
  })

  it('creates a Modbus device on the Mega without TCP on RTU, on Serial1, with Reconnect unchecked', async () => {
    createModbusDevice(openRemoteDeviceCard('Arduino Mega', MEGA_WITHOUT_TCP), 'Drive')

    await waitFor(() =>
      expect(configOf('Drive')).toMatchObject({ transport: 'rtu', serialPort: 'Serial1', reconnect: false }),
    )
  })

  it('creates a Modbus device on the Mega with TCP on TCP, with Reconnect unchecked', async () => {
    createModbusDevice(openRemoteDeviceCard('Arduino Mega', MEGA_WITH_TCP), 'Drive')

    await waitFor(() => expect(configOf('Drive')).toMatchObject({ transport: 'tcp', reconnect: false }))
  })

  it.each([
    ['Runtime v3', 'OpenPLC Runtime v3', RUNTIME_V3],
    ['the Uno Q', 'Arduino Uno Q', UNO_Q],
  ])('says remote devices are not available when the card is rendered on %s', (_target, name, board) => {
    selectBoard(name, board)
    render(<ElementCard target='remote-device' closeContainer={() => undefined} />, {
      wrapper: createStoreWrapper(store),
    })
    fireEvent.mouseEnter(screen.getByTestId('create-remote-device'))

    expect(screen.getByTestId('remote-device-unavailable').textContent).toBe(UNAVAILABLE)
    expect(document.getElementById('remote-device-name')).toBeNull()
    expect(screen.queryByText(/OpenPLC Runtime v4/)).toBeNull()
  })
})
