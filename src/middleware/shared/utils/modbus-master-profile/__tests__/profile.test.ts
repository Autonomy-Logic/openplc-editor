import type { BoardInfo } from '../../../ports/types'
import { RUNTIME_V3_CAPABILITIES, resolveTargetCapabilities } from '../../target-capabilities'
import {
  canHostModbusMaster,
  createDefaultRemoteDeviceConfig,
  endpointKey,
  type ModbusMasterProfile,
  resolveModbusMasterProfile,
} from '..'

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

/** Official package with the TCP master opt-in: one UART, the debugger's. */
const UNO = baremetal({
  serialPorts: ['Serial'],
  defaultSerial: 'Serial',
  capabilities: { modbusTcpMaster: true },
  vpp: vpp(BOARD_SCREENS),
})
const NANO = baremetal({
  serialPorts: ['Serial'],
  defaultSerial: 'Serial',
  capabilities: { modbusTcpMaster: true },
  vpp: vpp(BOARD_SCREENS),
})
/** No network and no UART besides the debugger's. */
const UNO_Q = baremetal({ serialPorts: ['Serial'], defaultSerial: 'Serial', vpp: vpp({ Serial: {} }) })
/** Today's package for the Uno: no TCP opt-in. */
const UNO_WITHOUT_TCP = baremetal({ serialPorts: ['Serial'], defaultSerial: 'Serial', vpp: vpp(BOARD_SCREENS) })
const MEGA = baremetal({
  serialPorts: ['Serial', 'Serial1', 'Serial2', 'Serial3'],
  defaultSerial: 'Serial',
  capabilities: { modbusTcpMaster: true, networkSockets: 4 },
  vpp: vpp(BOARD_SCREENS),
})
/** Today's package for the Mega: no TCP opt-in, three spare UARTs. */
const MEGA_WITHOUT_TCP = baremetal({
  serialPorts: ['Serial', 'Serial1', 'Serial2', 'Serial3'],
  defaultSerial: 'Serial',
  vpp: vpp(BOARD_SCREENS),
})
/** Declares no `serialPorts` at all. */
const LOGO = baremetal({ capabilities: { modbusTcpMaster: true }, vpp: vpp({ Network: {} }) })
/** No `defaultSerial`: the debugger is on `Serial`. */
const NO_DEFAULT_SERIAL = baremetal({ serialPorts: ['Serial2', 'Serial', 'Serial1'], vpp: vpp(BOARD_SCREENS) })
/** The debugger is on `Serial1`, so `Serial` is free for RTU. */
const DEBUGGER_ON_SERIAL1 = baremetal({
  serialPorts: ['Serial', 'Serial1', 'Serial2'],
  defaultSerial: 'Serial1',
  vpp: vpp(BOARD_SCREENS),
})
const NO_BOARD_PAGES = baremetal({
  serialPorts: ['Serial', 'Serial1'],
  defaultSerial: 'Serial',
  capabilities: { modbusTcpMaster: true },
  vpp: vpp({ Modbus: {} }),
})

const RUNTIME_V4: BoardInfo = { compiler: 'openplc-compiler', core: '', preview: '', specs: {} }
const SIMULATOR: BoardInfo = { compiler: 'simulator', core: '', preview: '', specs: {} }

const profileOf = (board: BoardInfo): ModbusMasterProfile =>
  resolveModbusMasterProfile(board, resolveTargetCapabilities(board))

const runtimeV3Profile = (): ModbusMasterProfile =>
  resolveModbusMasterProfile(
    { compiler: 'openplc-compiler', core: '', preview: '', specs: {} },
    RUNTIME_V3_CAPABILITIES,
  )

describe('resolveModbusMasterProfile on baremetal boards', () => {
  it('offers TCP only on the Uno, whose one UART carries the debugger', () => {
    expect(profileOf(UNO).transports).toEqual(['tcp'])
  })

  it('offers TCP only on the Nano, whose one UART carries the debugger', () => {
    expect(profileOf(NANO).transports).toEqual(['tcp'])
  })

  it('offers nothing on the Uno Q, which has no network and no spare UART', () => {
    expect(profileOf(UNO_Q).transports).toEqual([])
  })

  it('offers nothing on the Uno with a package that has no TCP opt-in', () => {
    expect(profileOf(UNO_WITHOUT_TCP).transports).toEqual([])
  })

  it('offers both transports on the Mega, TCP first', () => {
    expect(profileOf(MEGA).transports).toEqual(['tcp', 'rtu'])
  })

  it('offers RTU only on the Mega with a package that has no TCP opt-in', () => {
    expect(profileOf(MEGA_WITHOUT_TCP).transports).toEqual(['rtu'])
  })

  it('offers TCP only on a board that declares no serial ports', () => {
    expect(profileOf(LOGO).transports).toEqual(['tcp'])
    expect(profileOf(LOGO).rtuPorts).toEqual({ source: 'board', ports: [] })
  })

  it("lists the board's UARTs without the debugger's, in manifest order", () => {
    expect(profileOf(MEGA).rtuPorts).toEqual({ source: 'board', ports: ['Serial1', 'Serial2', 'Serial3'] })
  })

  it('treats an absent defaultSerial as Serial', () => {
    expect(profileOf(NO_DEFAULT_SERIAL).rtuPorts).toEqual({ source: 'board', ports: ['Serial2', 'Serial1'] })
    expect(profileOf(NO_DEFAULT_SERIAL).transports).toContain('rtu')
  })

  it('removes the UART the debugger is on, whichever it is', () => {
    expect(profileOf(DEBUGGER_ON_SERIAL1).rtuPorts).toEqual({ source: 'board', ports: ['Serial', 'Serial2'] })
  })

  it('lists no UART on the Uno, so RTU is not offered', () => {
    expect(profileOf(UNO).rtuPorts).toEqual({ source: 'board', ports: [] })
    expect(profileOf(UNO).transports).not.toContain('rtu')
  })

  it('accepts only an IPv4 host', () => {
    expect(profileOf(MEGA).hostKind).toBe('ipv4-only')
  })

  it('takes the socket budget from the declared network sockets', () => {
    expect(profileOf(MEGA).socketBudget).toBe(4)
  })

  it('has no socket budget where the board declares none', () => {
    expect(profileOf(UNO).socketBudget).toBeNull()
  })

  it('runs the devices it configures', () => {
    expect(profileOf(MEGA).runsDevices).toBe(true)
  })

  it("names the package's serial and network screens", () => {
    expect(profileOf(MEGA).vppScreens).toEqual({ serial: 'Serial', network: 'Network' })
  })

  it('finds the board screens whatever their casing', () => {
    const board = baremetal({ ...MEGA, vpp: vpp({ serial: {}, NETWORK: {} }) })
    expect(profileOf(board).vppScreens).toEqual({ serial: 'serial', network: 'NETWORK' })
  })

  it('names no screen the package does not ship', () => {
    const screens = profileOf(NO_BOARD_PAGES).vppScreens
    expect(screens.serial).toBeUndefined()
    expect(screens.network).toBeUndefined()
  })

  it('shows the board links, even when the package ships no such page', () => {
    expect(profileOf(MEGA).showBoardLinks).toBe(true)
    expect(profileOf(NO_BOARD_PAGES).showBoardLinks).toBe(true)
  })
})

describe('resolveModbusMasterProfile on runtime targets', () => {
  it('gives Runtime v4 both transports, runtime ports, hostnames and no board links', () => {
    expect(profileOf(RUNTIME_V4)).toEqual({
      transports: ['tcp', 'rtu'],
      rtuPorts: { source: 'runtime' },
      hostKind: 'ipv4-or-hostname',
      socketBudget: null,
      runsDevices: true,
      vppScreens: {},
      showBoardLinks: false,
    })
  })

  it('gives the Simulator the Runtime v4 screen, but runs no device', () => {
    expect(profileOf(SIMULATOR)).toEqual({
      transports: ['tcp', 'rtu'],
      rtuPorts: { source: 'runtime' },
      hostKind: 'ipv4-or-hostname',
      socketBudget: null,
      runsDevices: false,
      vppScreens: {},
      showBoardLinks: false,
    })
  })

  it('gives Runtime v3 no transport, no board screen and no board link', () => {
    const profile = runtimeV3Profile()
    expect(profile.transports).toEqual([])
    expect(profile.vppScreens).toEqual({})
    expect(profile.showBoardLinks).toBe(false)
  })

  it('gives an unknown target no transport, no board screen and no board link', () => {
    const profile = resolveModbusMasterProfile(undefined, resolveTargetCapabilities(undefined))
    expect(profile.transports).toEqual([])
    expect(profile.vppScreens).toEqual({})
    expect(profile.showBoardLinks).toBe(false)
  })
})

describe('canHostModbusMaster', () => {
  it.each([
    ['the Uno with the TCP opt-in', UNO],
    ['the Nano with the TCP opt-in', NANO],
    ['the Mega', MEGA],
    ['the Mega without the TCP opt-in', MEGA_WITHOUT_TCP],
    ['Runtime v4', RUNTIME_V4],
    ['the Simulator', SIMULATOR],
  ])('offers a Remote Device on %s', (_name, board) => {
    expect(canHostModbusMaster(profileOf(board))).toBe(true)
  })

  it.each([
    ['the Uno Q', UNO_Q],
    ['the Uno without the TCP opt-in', UNO_WITHOUT_TCP],
  ])('offers no Remote Device on %s', (_name, board) => {
    expect(canHostModbusMaster(profileOf(board))).toBe(false)
  })

  it('offers no Remote Device on Runtime v3', () => {
    expect(canHostModbusMaster(runtimeV3Profile())).toBe(false)
  })

  it('offers no Remote Device on an unknown target', () => {
    expect(canHostModbusMaster(resolveModbusMasterProfile(undefined, resolveTargetCapabilities(undefined)))).toBe(false)
  })
})

describe('createDefaultRemoteDeviceConfig', () => {
  it("starts a Runtime v4 device on TCP with today's defaults and Reconnect unchecked", () => {
    expect(createDefaultRemoteDeviceConfig(profileOf(RUNTIME_V4))).toEqual({
      transport: 'tcp',
      host: '127.0.0.1',
      port: 502,
      slaveId: 1,
      timeout: 1000,
      ioGroups: [],
      reconnect: false,
    })
  })

  it('starts a device on the Mega on TCP with Reconnect unchecked', () => {
    const config = createDefaultRemoteDeviceConfig(profileOf(MEGA))
    expect(config.transport).toBe('tcp')
    expect(config.reconnect).toBe(false)
  })

  it('starts a device on an RTU-only board on RTU, on the first board UART, with Reconnect unchecked', () => {
    expect(createDefaultRemoteDeviceConfig(profileOf(MEGA_WITHOUT_TCP))).toMatchObject({
      transport: 'rtu',
      serialPort: 'Serial1',
      slaveId: 1,
      timeout: 1000,
      ioGroups: [],
      reconnect: false,
    })
  })

  it('hands out a fresh I/O group list on every call', () => {
    const profile = profileOf(RUNTIME_V4)
    expect(createDefaultRemoteDeviceConfig(profile).ioGroups).not.toBe(
      createDefaultRemoteDeviceConfig(profile).ioGroups,
    )
  })
})

describe('endpointKey', () => {
  type Config = Parameters<typeof endpointKey>[0]
  const tcp = (over: Partial<Config>): Config => ({ transport: 'tcp', timeout: 1000, ioGroups: [], ...over })

  it('keys a baremetal TCP device by its parsed IPv4 octets and port', () => {
    expect(endpointKey(tcp({ host: '192.168.1.10', port: 502 }), profileOf(MEGA))).toBe('192.168.1.10:502')
  })

  it('reads the octets as decimal numbers on baremetal', () => {
    expect(endpointKey(tcp({ host: '192.168.001.010', port: 502 }), profileOf(MEGA))).toBe('192.168.1.10:502')
  })

  it('keys a baremetal device with no transport as TCP', () => {
    const config: Config = { host: '10.0.0.7', port: 1502, timeout: 1000, ioGroups: [] }
    expect(endpointKey(config, profileOf(MEGA))).toBe('10.0.0.7:1502')
  })

  it.each(['plc.local', '256.1.1.1', '10.0.0', '10.0.0.1.5', ''])(
    'gives no key on baremetal for a host that is not an IPv4 address (%p)',
    (host) => {
      expect(endpointKey(tcp({ host, port: 502 }), profileOf(MEGA))).toBeNull()
    },
  )

  it('gives no key to an RTU device', () => {
    const config: Config = {
      transport: 'rtu',
      serialPort: 'Serial1',
      host: '10.0.0.1',
      port: 502,
      timeout: 1000,
      ioGroups: [],
    }
    expect(endpointKey(config, profileOf(MEGA))).toBeNull()
    expect(endpointKey(config, profileOf(RUNTIME_V4))).toBeNull()
  })

  it('keys a Runtime v4 device by the host text exactly as written', () => {
    expect(endpointKey(tcp({ host: 'plc.local', port: 1502 }), profileOf(RUNTIME_V4))).toBe('plc.local:1502')
    expect(endpointKey(tcp({ host: '192.168.001.010', port: 502 }), profileOf(RUNTIME_V4))).toBe('192.168.001.010:502')
  })

  it('keys a Runtime v4 device with the host and port the JSON falls back to', () => {
    const config: Config = { transport: 'tcp', timeout: 1000, ioGroups: [] }
    expect(endpointKey(config, profileOf(RUNTIME_V4))).toBe('127.0.0.1:502')
  })
})
