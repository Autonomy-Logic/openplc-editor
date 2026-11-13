import type { OpenPLCStore } from '@root/frontend/store'
import { CreateServerEditor } from '@root/frontend/store/slices/tabs/utils'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import type { BoardInfo } from '@root/middleware/shared/ports/types'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { ModbusServerEditor } from '..'

const BAREMETAL: BoardInfo = {
  compiler: 'arduino-cli',
  core: 'arduino:avr',
  preview: '',
  specs: {},
  serialPorts: ['Serial', 'Serial1'],
  defaultSerial: 'Serial',
  vpp: {
    packageId: 'com.openplc.arduino',
    vendor: 'OpenPLC',
    deviceId: 'board',
    packagePath: '/packages/com.openplc.arduino',
    screens: { Serial: {}, Network: {} },
    moduleSystem: null,
  },
}

const RUNTIME_V4: BoardInfo = {
  compiler: 'openplc-compiler',
  core: '',
  preview: '',
  specs: {},
  capabilities: { modbusTcpServer: true },
}

let store: OpenPLCStore

const openServer = (boardName: string, board: BoardInfo) => {
  store.getState().deviceActions.setAvailableOptions({ availableBoards: new Map([[boardName, board]]) })
  store.getState().deviceActions.setDeviceBoard(boardName)
  expect(store.getState().projectActions.createServer({ data: { name: 'MB1', protocol: 'modbus-tcp' } }).ok).toBe(true)
  store.getState().editorActions.setEditor(CreateServerEditor('MB1', 'modbus-tcp'))
  render(<ModbusServerEditor />, { wrapper: createStoreWrapper(store) })
}

const action = (label: string): HTMLElement => {
  const control = screen.getByText(label).closest<HTMLElement>('button, [role="button"]')
  if (!control) throw new Error(`${label} is not a control`)
  return control
}

const expectVendorScreenOpened = (screenName: string) => {
  expect(store.getState().editor).toMatchObject({ type: 'plc-vendor-screen', meta: { screenName } })
  expect(store.getState().tabs).toContainEqual(
    expect.objectContaining({ name: screenName, path: `/vendor-screen/${screenName}` }),
  )
  expect(store.getState().selectedTab).toBe(screenName)
}

beforeEach(() => {
  store = createTestStore()
})

afterEach(() => {
  cleanup()
})

describe('Modbus server board settings links', () => {
  it('opens the board Serial page on baremetal', () => {
    openServer('Arduino Mega', BAREMETAL)

    fireEvent.click(action('Board serial settings'))

    expectVendorScreenOpened('Serial')
  })

  it('opens the board Network page on baremetal', () => {
    openServer('Arduino Mega', BAREMETAL)

    fireEvent.click(action('Board network settings'))

    expectVendorScreenOpened('Network')
  })

  it.each([
    ['Board serial settings', "The host operating system owns this target's serial."],
    ['Board network settings', "The host operating system owns this target's network."],
  ])('disables %s on Runtime v4 and gives the reason', async (label, reason) => {
    openServer('OpenPLC Runtime v4', RUNTIME_V4)
    const control = action(label)

    expect(control.matches(':disabled')).toBe(true)
    const icon = control.parentElement?.querySelector<HTMLElement>('[aria-label="Field help"]')
    if (!icon) throw new Error(`no help icon beside ${label}`)
    fireEvent.focus(icon)
    expect(await screen.findAllByText(reason)).not.toHaveLength(0)
  })
})
