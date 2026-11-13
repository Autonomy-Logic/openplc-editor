import type { OpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { BoardInfo, PLCRemoteDevice, PLCServer } from '@root/middleware/shared/ports/types'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { RUNTIME_V3_CAPABILITIES, SIMULATOR_CAPABILITIES } from '@root/middleware/shared/utils/target-capabilities'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { Board } from '../board'

function stubPort<T extends object>(overrides: Partial<NoInfer<T>> = {}): T {
  return new Proxy(overrides as T, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

const vpp = (deviceId: string): BoardInfo['vpp'] => ({
  packageId: 'com.openplc.arduino',
  vendor: 'Arduino',
  deviceId,
  packagePath: '/packages/com.openplc.arduino',
  screens: { Serial: {}, Network: {} },
  moduleSystem: null,
})

const MEGA: BoardInfo = {
  compiler: 'arduino-cli',
  core: 'arduino:avr',
  platform: 'arduino:avr:mega',
  preview: '',
  specs: {},
  serialPorts: ['Serial', 'Serial1', 'Serial2', 'Serial3'],
  defaultSerial: 'Serial',
  capabilities: { modbusTcpMaster: true, networkSockets: 4 },
  vpp: vpp('mega'),
}

const UNO: BoardInfo = {
  compiler: 'arduino-cli',
  core: 'arduino:avr',
  platform: 'arduino:avr:uno',
  preview: '',
  specs: {},
  serialPorts: ['Serial'],
  defaultSerial: 'Serial',
  capabilities: { modbusTcpMaster: true },
  vpp: vpp('uno'),
}

const RUNTIME_V3: BoardInfo = {
  compiler: 'openplc-compiler',
  core: '',
  preview: '',
  specs: {},
  capabilities: RUNTIME_V3_CAPABILITIES,
}

const SIMULATOR: BoardInfo = {
  compiler: 'simulator',
  core: '',
  preview: '',
  specs: {},
  capabilities: SIMULATOR_CAPABILITIES,
}

const BOARDS = new Map<string, BoardInfo>([
  ['OpenPLC Runtime v3', RUNTIME_V3],
  ['OpenPLC Simulator', SIMULATOR],
  ['Arduino Mega', MEGA],
  ['Arduino Uno', UNO],
])

const RTU_ON_SERIAL2: PLCRemoteDevice = {
  name: 'Drive',
  protocol: 'modbus-tcp',
  modbusTcpConfig: {
    transport: 'rtu',
    serialPort: 'Serial2',
    baudRate: 9600,
    parity: 'N',
    stopBits: 1,
    dataBits: 8,
    slaveId: 1,
    timeout: 1000,
    ioGroups: [],
  },
}

const MODBUS_SERVER: PLCServer = {
  name: 'Modbus',
  protocol: 'modbus-tcp',
  modbusSlaveConfig: { enabled: true, networkInterface: '0.0.0.0', port: 502 },
}

const V4_ONLY_SENTENCE = 'only supported on OpenPLC Runtime v4'

let store: OpenPLCStore

/** Renders the board screen on `currentBoard` for a project holding `remoteDevices` and `servers`. */
function renderBoard(currentBoard: string, project: { remoteDevices?: PLCRemoteDevice[]; servers?: PLCServer[] }) {
  const { deviceActions, projectActions } = store.getState()
  deviceActions.setAvailableOptions({ availableBoards: BOARDS })
  deviceActions.setDeviceBoard(currentBoard)
  const current = store.getState().project
  projectActions.setProject({
    ...current,
    data: { ...current.data, remoteDevices: project.remoteDevices ?? [], servers: project.servers ?? [] },
  })

  const ports: PlatformPorts = {
    compiler: stubPort(),
    runtime: stubPort(),
    debugger: stubPort(),
    simulator: stubPort(),
    project: stubPort(),
    device: stubPort({ getPreviewImage: () => Promise.resolve('') }),
    orchestrator: stubPort(),
    system: stubPort(),
    window: stubPort(),
    accelerator: stubPort(),
    theme: stubPort(),
    versionControl: stubPort(),
    navigation: stubPort(),
    library: stubPort(),
    packages: undefined,
    capabilities: EDITOR_CAPABILITIES,
  }
  render(<Board />, { wrapper: createStoreWrapper(store, ports) })
}

/** Opens the device list from the keyboard and picks `name`. */
function switchTo(name: string) {
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Device selection' }), { key: 'Enter' })
  const option = screen
    .getAllByText(name)
    .map((node) => node.closest('[role="option"]'))
    .find((node): node is HTMLElement => node instanceof HTMLElement)
  if (!option) throw new Error(`no option for ${name}`)
  fireEvent.click(option)
}

/** The open dialog's text with its whitespace collapsed. */
async function dialogText(): Promise<string> {
  const dialog = await screen.findByRole('dialog')
  return (dialog.textContent ?? '').replace(/\s+/g, ' ')
}

describe('Board switch dialog for remote devices', () => {
  beforeEach(() => {
    store = createTestStore()
  })

  afterEach(() => {
    cleanup()
  })

  it('keeps the Runtime v3 wording for remote devices without the v4-only sentence (TC23)', async () => {
    renderBoard('Arduino Mega', { remoteDevices: [RTU_ON_SERIAL2] })
    switchTo('OpenPLC Runtime v3')

    const text = await dialogText()
    expect(text).toContain('The selected target (OpenPLC Runtime v3) does not support Remote IO configuration.')
    expect(text).toContain(
      'Your project contains Remote IO configurations that will be disabled during compilation on this target.',
    )
    expect(text).not.toContain(V4_ONLY_SENTENCE)
  })

  it('keeps only the Modbus Server sentence when servers and remote devices are both affected', async () => {
    renderBoard('Arduino Mega', { remoteDevices: [RTU_ON_SERIAL2], servers: [MODBUS_SERVER] })
    switchTo('OpenPLC Runtime v3')

    const text = await dialogText()
    expect(text).toContain(
      'Your project contains Modbus Server and Remote IO configurations that will be disabled during compilation on this target.',
    )
    expect(text).toContain('Modbus Server is only supported on OpenPLC Runtime v4.')
    expect(text).not.toMatch(/Remote IO (is|are) only supported/)
    expect(text).not.toContain('Modbus Server and Remote IO are')
  })

  it('leaves the servers-only wording as it is', async () => {
    renderBoard('Arduino Mega', { servers: [MODBUS_SERVER] })
    switchTo('OpenPLC Runtime v3')

    const text = await dialogText()
    expect(text).toContain(
      'Your project contains Modbus Server configurations that will be disabled during compilation on this target. Modbus Server is only supported on OpenPLC Runtime v4.',
    )
  })

  it('switches to the Simulator without a dialog, as today', () => {
    renderBoard('Arduino Mega', { remoteDevices: [RTU_ON_SERIAL2] })
    switchTo('OpenPLC Simulator')

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(store.getState().deviceDefinitions.configuration.deviceBoard).toBe('OpenPLC Simulator')
  })

  it('says the build will be refused when a baremetal board cannot run a device (BR21)', async () => {
    renderBoard('Arduino Mega', { remoteDevices: [RTU_ON_SERIAL2] })
    switchTo('Arduino Uno')

    const text = await dialogText()
    expect(text).toMatch(/stay in the project/i)
    expect(text).toMatch(/refused/i)
    expect(text).toMatch(/fixed or removed/i)
    expect(text).not.toContain('will be disabled during compilation')
    expect(text).not.toContain(V4_ONLY_SENTENCE)
  })

  it('switches without a dialog to a baremetal board that runs every device', () => {
    renderBoard('Arduino Uno', { remoteDevices: [RTU_ON_SERIAL2] })
    switchTo('Arduino Mega')

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(store.getState().deviceDefinitions.configuration.deviceBoard).toBe('Arduino Mega')
  })
})
