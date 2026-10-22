/**
 * Describing a Runtime v3/v4 target's debug channel — through the SAME resolver
 * Connect uses, with the target's declared transports deciding what is eligible.
 *
 * The regression these pin: eligibility used to be a hardcoded serial-then-TCP list
 * inside the resolver, so a `websocket` channel was never a candidate. No runtime
 * session was ever opened, and every command then answered "not connected" on a
 * target the user had connected to and uploaded a program to. The fix is not a
 * second code path for runtimes — it is asking the target which media it speaks.
 */
import type { DebugSpec } from '../../../backend/shared/hardware/debug-spec'
import type { BoardInfo } from '../../../middleware/shared/ports/types'
import type { OpenPLCStore } from '../../store'
import { createTestStore } from '../../store/testing'
import { describeConnectTarget, resolveRuntimeDebugChannel } from '../device-link-resolution'

/** A board carries BOTH halves: the spec says how a channel is built, the
 *  capability matrix says which channels the target can actually speak. */
const boardWith = (spec: DebugSpec, transports: string[]): BoardInfo =>
  ({ debug: spec, capabilities: { debuggerTransports: transports } }) as unknown as BoardInfo

/** The shape a Runtime v4 board declares — an SLM-RP4's, verbatim. */
const v4Spec: DebugSpec = {
  preconditions: ['runtimeConnected', 'jwtToken'],
  channels: [
    {
      label: 'WebSocket',
      channel: 'websocket',
      enabledWhen: true,
      params: {
        ipAddress: { $ref: 'configuration.runtimeIpAddress', required: 'Runtime IP address is not configured.' },
        jwtToken: { $ref: 'runtimeConnection.jwtToken', required: 'JWT token missing. Reconnect to the runtime.' },
      },
    },
  ],
}

/** Runtime v3: same shape, debugged over Modbus TCP instead. */
const v3Spec: DebugSpec = {
  preconditions: ['runtimeConnected'],
  channels: [
    {
      label: 'Modbus TCP',
      channel: 'tcp',
      enabledWhen: true,
      params: { ipAddress: { $ref: 'configuration.runtimeIpAddress', required: 'Runtime IP address is not set.' } },
    },
  ],
}

let store: OpenPLCStore

const loggedMessages = () => store.getState().logs.map((log) => log.message)

beforeEach(() => {
  store = createTestStore()
  const { deviceActions } = store.getState()
  deviceActions.setDeviceBoard('OpenPLC Runtime v4')
  deviceActions.setRuntimeIpAddress('192.168.0.42')
  deviceActions.setRuntimeConnectionStatus('connected')
  deviceActions.setRuntimeJwtToken('jwt-token')
})

describe('resolveRuntimeDebugChannel', () => {
  it('describes a v4 target as its WebSocket channel', () => {
    const config = resolveRuntimeDebugChannel(store, 'OpenPLC Runtime v4', boardWith(v4Spec, ['websocket']))

    expect(config).not.toBeNull()
    expect(config?.connectionType).toBe('websocket')
    expect(config?.connectionParams.ipAddress).toBe('192.168.0.42')
    expect(config?.connectionParams.jwtToken).toBe('jwt-token')
  })

  it('describes a v3 target as its Modbus TCP channel', () => {
    const config = resolveRuntimeDebugChannel(store, 'OpenPLC Runtime v3', boardWith(v3Spec, ['modbus-tcp']))

    expect(config?.connectionType).toBe('tcp')
    expect(config?.connectionParams.ipAddress).toBe('192.168.0.42')
  })

  it('returns null and SAYS SO when a board declares no debug spec', () => {
    // Failing quietly is what hid the bug above until it reached hardware.
    expect(resolveRuntimeDebugChannel(store, 'Some Board', undefined)).toBeNull()
    expect(loggedMessages()).toContainEqual(expect.stringContaining('no debug spec'))
  })

  it('returns null and says why when the spec cannot be satisfied', () => {
    // v4 requires a JWT; without one the resolver refuses, and the user should be
    // able to see that rather than meet "not connected" later.
    store.getState().deviceActions.setRuntimeJwtToken(null)

    expect(resolveRuntimeDebugChannel(store, 'OpenPLC Runtime v4', boardWith(v4Spec, ['websocket']))).toBeNull()
    expect(loggedMessages()).toContainEqual(expect.stringContaining('could NOT describe a debug channel'))
  })

  it('traces the channel it settled on', () => {
    resolveRuntimeDebugChannel(store, 'OpenPLC Runtime v4', boardWith(v4Spec, ['websocket']))
    expect(loggedMessages()).toContainEqual(expect.stringContaining('debug channel is websocket'))
  })
})

/** An ESP32's spec, as the Espressif package declares it: serial first, then Modbus TCP when networked. */
const espSpec: DebugSpec = {
  channels: [
    {
      label: 'Modbus RTU',
      channel: 'rtu',
      enabledWhen: true,
      params: {
        port: { $ref: 'configuration.communicationPort', required: 'No serial port selected.' },
        baudRate: { $ref: 'screens.serial.baud_rate', default: '115200', as: 'number' },
        slaveId: 1,
      },
    },
    {
      label: 'Modbus TCP',
      channel: 'tcp',
      enabledWhen: { $ref: 'screens.network.enabled' },
      params: { ipAddress: { $ref: 'screens.network.ip_address' } },
      prompts: [
        {
          when: { $ref: 'screens.network.enable_dhcp' },
          field: 'ipAddress',
          title: 'Target IP Address',
          message: 'Enter the IP address.',
          cacheKey: 'lastDhcpIp',
        },
      ],
    },
  ],
}
const esp32 = boardWith(espSpec, ['modbus-serial', 'modbus-tcp'])

describe('describeConnectTarget', () => {
  beforeEach(() => {
    const { deviceActions } = store.getState()
    deviceActions.setRuntimeConnectionStatus('disconnected')
    deviceActions.setRuntimeJwtToken(null)
    deviceActions.setDeviceBoard('ESP32 WROOM')
    deviceActions.setRuntimeIpAddress('localhost')
    deviceActions.setCommunicationPort('/dev/ttyUSB0')
  })

  it('names a runtime by its configured IP address', () => {
    store.getState().deviceActions.setRuntimeIpAddress('192.168.1.188')

    expect(describeConnectTarget(store, 'OpenPLC Runtime v4', boardWith(v4Spec, ['websocket']), true)).toBe(
      'OpenPLC Runtime v4 at 192.168.1.188',
    )
  })

  it('names a device by its serial port, never the runtime address', () => {
    expect(describeConnectTarget(store, 'ESP32 WROOM', esp32, false)).toBe('ESP32 WROOM at /dev/ttyUSB0')
  })

  it('lists serial then the static Modbus TCP address when the network is enabled', () => {
    store.getState().deviceActions.setVendorScreenData('network', { enabled: true, ip_address: '192.168.1.50' })

    expect(describeConnectTarget(store, 'ESP32 WROOM', esp32, false)).toBe(
      'ESP32 WROOM at /dev/ttyUSB0 or 192.168.1.50',
    )
  })

  it('leaves out a DHCP channel whose address is not known yet', () => {
    store.getState().deviceActions.setVendorScreenData('network', { enabled: true, enable_dhcp: true })

    expect(describeConnectTarget(store, 'ESP32 WROOM', esp32, false)).toBe('ESP32 WROOM at /dev/ttyUSB0')
  })

  it('falls back to the board name when nothing is configured', () => {
    store.getState().deviceActions.setCommunicationPort('')

    expect(describeConnectTarget(store, 'ESP32 WROOM', esp32, false)).toBe('ESP32 WROOM')
    expect(describeConnectTarget(store, 'ESP32 WROOM', undefined, false)).toBe('ESP32 WROOM')
  })
})
