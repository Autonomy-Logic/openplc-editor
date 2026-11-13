import type { OpenPLCStore } from '@root/frontend/store'
import { CreateRemoteDeviceEditor } from '@root/frontend/store/slices/tabs/utils'
import { createStoreWrapper, createTestPorts, createTestStore } from '@root/frontend/store/testing'
import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { BoardInfo, PLCRemoteDevice } from '@root/middleware/shared/ports/types'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { RemoteDeviceEditor } from '..'

const RECONNECT_HELP =
  'When unchecked, the device is given up after a failed first connection or a lost connection, including a brief network fault or a reset sent by another host, and is not contacted again until Stop then Start or a reset of the controller. Check Reconnect for production devices: the master then retries after 2 s, growing x1.5 up to 30 s.'

const TIMEOUT_HELP = 'On a microcontroller, each connection attempt can hold the scan for up to this time.'

const BOARD_SCREENS = { Serial: {}, Network: {} }

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

/** Official package with the TCP master opt-in; its one UART carries the debugger. */
const UNO = baremetal({
  serialPorts: ['Serial'],
  defaultSerial: 'Serial',
  capabilities: { modbusTcpMaster: true },
  vpp: vpp(BOARD_SCREENS),
})
const NANO = UNO
const MEGA = baremetal({
  serialPorts: ['Serial', 'Serial1', 'Serial2', 'Serial3'],
  defaultSerial: 'Serial',
  capabilities: { modbusTcpMaster: true },
  vpp: vpp(BOARD_SCREENS),
})
/** A package that ships neither a Serial nor a Network page. */
const MEGA_WITHOUT_PAGES = baremetal({
  serialPorts: ['Serial', 'Serial1', 'Serial2', 'Serial3'],
  defaultSerial: 'Serial',
  capabilities: { modbusTcpMaster: true },
  vpp: vpp({}),
})
const RUNTIME_V4: BoardInfo = { compiler: 'openplc-compiler', core: '', preview: '', specs: {} }
const SIMULATOR: BoardInfo = { compiler: 'simulator', core: '', preview: '', specs: {} }

const tcpDevice = (reconnect?: boolean): PLCRemoteDevice => ({
  name: 'Pump',
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

const rtuDevice = (serialPort?: string): PLCRemoteDevice => ({
  name: 'Pump',
  protocol: 'modbus-tcp',
  modbusTcpConfig: {
    transport: 'rtu',
    ...(serialPort === undefined ? {} : { serialPort }),
    baudRate: 9600,
    parity: 'N',
    stopBits: 1,
    dataBits: 8,
    slaveId: 1,
    timeout: 1000,
    ioGroups: [],
  },
})

let store: OpenPLCStore
let ports: PlatformPorts
const getSerialPorts = vi.fn(() =>
  Promise.resolve({ success: true, ports: [{ device: '/dev/ttyACM7', description: '/dev/ttyACM7' }] }),
)

const selectBoard = (name: string, board: BoardInfo) => {
  store.getState().deviceActions.setAvailableOptions({ availableBoards: new Map([[name, board]]) })
  store.getState().deviceActions.setDeviceBoard(name)
}

/** Opens a project holding `device` on `board` and renders its Remote Device screen. */
const openDevice = (boardName: string, board: BoardInfo, device: PLCRemoteDevice) => {
  selectBoard(boardName, board)
  const { project } = store.getState()
  store.getState().projectActions.setProject({ ...project, data: { ...project.data, remoteDevices: [device] } })
  store.getState().editorActions.setEditor(CreateRemoteDeviceEditor(device.name, 'modbus-tcp'))
  render(<RemoteDeviceEditor />, { wrapper: createStoreWrapper(store, ports) })
}

const configOf = () => store.getState().project.data.remoteDevices?.find((d) => d.name === 'Pump')?.modbusTcpConfig

/** The interactive element behind a test id, whether the id sits on it or on its wrapper. */
const interactive = (testId: string, selector: string): HTMLElement => {
  const element = screen.getByTestId(testId)
  if (element.matches(selector)) return element
  const inner = element.querySelector<HTMLElement>(selector)
  if (!inner) throw new Error(`${testId} holds no ${selector}`)
  return inner
}

/** Opens a picker from the keyboard and returns the labels it offers. */
const offeredBy = (testId: string): string[] => {
  fireEvent.keyDown(interactive(testId, 'button, [role="combobox"], [role="button"]'), { key: 'Enter' })
  return screen.getAllByRole('option').map((option) => (option.textContent ?? '').trim())
}

const reconnectBox = () => interactive('remote-device-reconnect-checkbox', 'input[type="checkbox"], [role="checkbox"]')

const isChecked = (control: HTMLElement) =>
  control instanceof HTMLInputElement ? control.checked : control.getAttribute('aria-checked') === 'true'

const boardLink = (testId: string) => interactive(testId, 'button, [role="button"], a')

const isDisabled = (control: HTMLElement) =>
  control.matches(':disabled') || control.getAttribute('aria-disabled') === 'true'

/** Focuses the help icon next to a board link and returns the reason it reveals. */
const reasonBeside = async (testId: string, reason: string) => {
  const holder = screen.getByTestId(testId)
  const icon =
    holder.querySelector<HTMLElement>('[aria-label="Field help"]') ??
    holder.parentElement?.querySelector<HTMLElement>('[aria-label="Field help"]')
  if (!icon) throw new Error(`no help icon beside ${testId}`)
  fireEvent.focus(icon)
  return screen.findAllByText(reason)
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
  getSerialPorts.mockClear()
  ports = createTestPorts({ capabilities: EDITOR_CAPABILITIES, runtime: { getSerialPorts } })
})

afterEach(() => {
  cleanup()
})

describe('Remote Device screen transports (TC19)', () => {
  it('offers TCP only on the Uno', () => {
    openDevice('Arduino Uno', UNO, tcpDevice())
    expect(offeredBy('remote-device-transport-select')).toEqual(['TCP/IP'])
  })

  it('offers TCP only on the Nano', () => {
    openDevice('Arduino Nano', NANO, tcpDevice())
    expect(offeredBy('remote-device-transport-select')).toEqual(['TCP/IP'])
  })

  it('offers both transports on the Mega', () => {
    openDevice('Arduino Mega', MEGA, tcpDevice())
    expect(offeredBy('remote-device-transport-select')).toEqual(['TCP/IP', 'RTU (Serial)'])
  })

  it('offers both transports on Runtime v4', () => {
    openDevice('OpenPLC Runtime v4', RUNTIME_V4, tcpDevice())
    expect(offeredBy('remote-device-transport-select')).toEqual(['TCP/IP', 'RTU (Serial)'])
  })
})

describe('Remote Device screen serial port (AC02)', () => {
  it("lists the Mega's UARTs without the debugger's", () => {
    openDevice('Arduino Mega', MEGA, rtuDevice('Serial1'))
    expect(offeredBy('remote-device-serial-port-select')).toEqual(['Serial1', 'Serial2', 'Serial3'])
  })

  it('shows a stored port outside the board list as it is, without rewriting it', () => {
    openDevice('Arduino Mega', MEGA, rtuDevice('/dev/ttyUSB0'))

    expect(screen.getByTestId('remote-device-serial-port-select').textContent).toContain('/dev/ttyUSB0')
    expect(configOf()?.serialPort).toBe('/dev/ttyUSB0')
  })

  it('puts a device switched to RTU on the first board UART', () => {
    openDevice('Arduino Mega', MEGA, tcpDevice())

    fireEvent.keyDown(interactive('remote-device-transport-select', 'button, [role="combobox"]'), { key: 'Enter' })
    fireEvent.click(screen.getByRole('option', { name: 'RTU (Serial)' }))

    expect(configOf()?.transport).toBe('rtu')
    expect(configOf()?.serialPort).toBe('Serial1')
  })

  it("lists the runtime's ports on Runtime v4, as today", async () => {
    store.getState().deviceActions.setRuntimeJwtToken('token')
    store.getState().deviceActions.setRuntimeConnectionStatus('connected')
    openDevice('OpenPLC Runtime v4', RUNTIME_V4, rtuDevice('/dev/ttyUSB0'))

    await waitFor(() => expect(getSerialPorts).toHaveBeenCalled())
    await act(async () => {
      await Promise.resolve()
    })
    fireEvent.keyDown(interactive('remote-device-serial-port-select', 'button, [role="combobox"], [role="button"]'), {
      key: 'Enter',
    })

    expect(await screen.findByRole('option', { name: /\/dev\/ttyACM7/ })).toBeTruthy()
  })

  it('has no RS-485 setting', () => {
    openDevice('Arduino Mega', MEGA, rtuDevice('Serial1'))
    expect(screen.queryByText(/RS-?485/i)).toBeNull()
  })
})

describe('Remote Device screen Reconnect (AC03, TC12, TC18)', () => {
  it('shows Reconnect checked for a TCP device saved before the option existed', () => {
    openDevice('OpenPLC Runtime v4', RUNTIME_V4, tcpDevice())
    expect(isChecked(reconnectBox())).toBe(true)
  })

  it('writes nothing when such a device is opened', () => {
    openDevice('OpenPLC Runtime v4', RUNTIME_V4, tcpDevice())
    expect(Object.keys(configOf() ?? {})).not.toContain('reconnect')
  })

  it('shows Reconnect unchecked for a device saved unchecked', () => {
    openDevice('Arduino Uno', UNO, tcpDevice(false))
    expect(isChecked(reconnectBox())).toBe(false)
  })

  it('shows Reconnect unchecked for a newly created TCP device', () => {
    selectBoard('OpenPLC Runtime v4', RUNTIME_V4)
    store.getState().remoteDeviceActions.create({ name: 'Pump', protocol: 'modbus-tcp' })
    render(<RemoteDeviceEditor />, { wrapper: createStoreWrapper(store, ports) })

    expect(isChecked(reconnectBox())).toBe(false)
  })

  it('writes Reconnect to the device when toggled', () => {
    openDevice('OpenPLC Runtime v4', RUNTIME_V4, tcpDevice())

    fireEvent.click(reconnectBox())
    expect(configOf()?.reconnect).toBe(false)

    fireEvent.click(reconnectBox())
    expect(configOf()?.reconnect).toBe(true)
  })

  it('shows no Reconnect on an RTU device', () => {
    openDevice('OpenPLC Runtime v4', RUNTIME_V4, rtuDevice('/dev/ttyUSB0'))
    expect(screen.queryByTestId('remote-device-reconnect-checkbox')).toBeNull()
    expect(screen.queryByTestId('remote-device-reconnect-help')).toBeNull()
  })
})

describe('Remote Device screen help texts (TC21)', () => {
  it.each([
    ['a baremetal board', 'Arduino Uno', UNO],
    ['Runtime v4', 'OpenPLC Runtime v4', RUNTIME_V4],
  ])('states what an unchecked Reconnect costs on %s', (_target, boardName, board) => {
    openDevice(boardName, board, tcpDevice())
    expect(screen.getByTestId('remote-device-reconnect-help').textContent).toBe(RECONNECT_HELP)
  })

  it('ties the Reconnect help to the checkbox', () => {
    openDevice('Arduino Uno', UNO, tcpDevice())
    const help = screen.getByTestId('remote-device-reconnect-help')

    expect(help.id).not.toBe('')
    expect(reconnectBox().getAttribute('aria-describedby')?.split(' ')).toContain(help.id)
  })

  it('warns on baremetal that a connection attempt can hold the scan', () => {
    openDevice('Arduino Uno', UNO, tcpDevice())
    expect(screen.getByTestId('remote-device-timeout-help').textContent).toBe(TIMEOUT_HELP)
  })

  it('gives no such warning on Runtime v4', () => {
    openDevice('OpenPLC Runtime v4', RUNTIME_V4, tcpDevice())
    expect(screen.queryByTestId('remote-device-timeout-help')).toBeNull()
  })
})

describe('Remote Device screen board settings links (TC22)', () => {
  it('links a TCP device on baremetal to the board network settings, and only to them', () => {
    openDevice('Arduino Mega', MEGA, tcpDevice())

    expect(boardLink('remote-device-board-network-link').textContent).toContain('Board network settings')
    expect(screen.queryByTestId('remote-device-board-serial-link')).toBeNull()
  })

  it('opens the board Network page from a TCP device', () => {
    openDevice('Arduino Mega', MEGA, tcpDevice())

    fireEvent.click(boardLink('remote-device-board-network-link'))

    expectVendorScreenOpened('Network')
  })

  it('links an RTU device on baremetal to the board serial settings, and only to them', () => {
    openDevice('Arduino Mega', MEGA, rtuDevice('Serial1'))

    expect(boardLink('remote-device-board-serial-link').textContent).toContain('Board serial settings')
    expect(screen.queryByTestId('remote-device-board-network-link')).toBeNull()
  })

  it('opens the board Serial page from an RTU device', () => {
    openDevice('Arduino Mega', MEGA, rtuDevice('Serial1'))

    fireEvent.click(boardLink('remote-device-board-serial-link'))

    expectVendorScreenOpened('Serial')
  })

  it('disables the network link, with its reason, when the package has no network page', async () => {
    openDevice('Arduino Mega', MEGA_WITHOUT_PAGES, tcpDevice())
    const link = boardLink('remote-device-board-network-link')

    expect(link.textContent).toContain('Board network settings')
    expect(isDisabled(link)).toBe(true)
    expect(
      await reasonBeside('remote-device-board-network-link', "This board's package has no network settings page."),
    ).not.toHaveLength(0)
  })

  it('disables the serial link, with its reason, when the package has no serial page', async () => {
    openDevice('Arduino Mega', MEGA_WITHOUT_PAGES, rtuDevice('Serial1'))
    const link = boardLink('remote-device-board-serial-link')

    expect(link.textContent).toContain('Board serial settings')
    expect(isDisabled(link)).toBe(true)
    expect(
      await reasonBeside('remote-device-board-serial-link', "This board's package has no serial settings page."),
    ).not.toHaveLength(0)
  })

  it.each([
    ['Runtime v4', 'OpenPLC Runtime v4', RUNTIME_V4],
    ['the Simulator', 'OpenPLC Simulator', SIMULATOR],
  ])('shows no board link on %s', (_target, boardName, board) => {
    openDevice(boardName, board, tcpDevice())
    expect(screen.queryByTestId('remote-device-board-network-link')).toBeNull()
    cleanup()

    openDevice(boardName, board, rtuDevice('/dev/ttyUSB0'))
    expect(screen.queryByTestId('remote-device-board-serial-link')).toBeNull()
  })
})

describe('Remote Device screen test ids', () => {
  it('names every TCP field', () => {
    openDevice('Arduino Mega', MEGA, tcpDevice())

    for (const id of [
      'remote-device-transport-select',
      'remote-device-host-input',
      'remote-device-port-input',
      'remote-device-reconnect-checkbox',
      'remote-device-reconnect-help',
      'remote-device-timeout-input',
      'remote-device-timeout-help',
      'remote-device-slave-id-input',
      'remote-device-board-network-link',
    ]) {
      expect(screen.getByTestId(id)).toBeTruthy()
    }
  })

  it('names every RTU field', () => {
    openDevice('Arduino Mega', MEGA, rtuDevice('Serial1'))

    for (const id of [
      'remote-device-transport-select',
      'remote-device-serial-port-select',
      'remote-device-timeout-input',
      'remote-device-slave-id-input',
      'remote-device-board-serial-link',
    ]) {
      expect(screen.getByTestId(id)).toBeTruthy()
    }
  })
})
