import type { BoardInfo, ModbusIOGroup, ModbusRemoteTcpConfig, PLCRemoteDevice } from '../../../ports/types'
import { RUNTIME_V3_CAPABILITIES, SIMULATOR_CAPABILITIES, resolveTargetCapabilities } from '../../target-capabilities'
import { checkModbusMaster } from '../checks'
import { endpointKey, resolveModbusMasterProfile } from '..'

type CheckInput = Parameters<typeof checkModbusMaster>[0]
type Issues = ReturnType<typeof checkModbusMaster>
type Target = CheckInput['target']

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

const MEGA = baremetal({
  serialPorts: ['Serial', 'Serial1', 'Serial2', 'Serial3'],
  defaultSerial: 'Serial',
  capabilities: { modbusTcpMaster: true, networkSockets: 4 },
  vpp: vpp(BOARD_SCREENS),
})
const UNO = baremetal({
  serialPorts: ['Serial'],
  defaultSerial: 'Serial',
  capabilities: { modbusTcpMaster: true },
  vpp: vpp(BOARD_SCREENS),
})
const UNO_WITHOUT_TCP = baremetal({ serialPorts: ['Serial'], defaultSerial: 'Serial', vpp: vpp(BOARD_SCREENS) })
/** The debugger sits on Serial1 on this board, not on Serial. */
const DEBUGGER_ON_SERIAL1 = baremetal({
  serialPorts: ['Serial', 'Serial1', 'Serial2'],
  defaultSerial: 'Serial1',
  capabilities: { modbusTcpMaster: true },
  vpp: vpp(BOARD_SCREENS),
})
/** A Mega whose package declares no socket count. */
const MEGA_WITHOUT_BUDGET = baremetal({
  serialPorts: ['Serial', 'Serial1', 'Serial2', 'Serial3'],
  defaultSerial: 'Serial',
  capabilities: { modbusTcpMaster: true },
  vpp: vpp(BOARD_SCREENS),
})
const RUNTIME_V4: BoardInfo = { compiler: 'openplc-compiler', core: '', preview: '', specs: {} }
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

const BOARD_OF: Record<Target, BoardInfo> = {
  baremetal: MEGA,
  'runtime-v4': RUNTIME_V4,
  'runtime-v3': RUNTIME_V3,
  simulator: SIMULATOR,
}

const group = (over: Partial<ModbusIOGroup> = {}): ModbusIOGroup => ({
  id: 'g1',
  name: 'Inputs',
  functionCode: '3',
  cycleTime: 100,
  offset: '0',
  length: 1,
  errorHandling: 'keep-last-value',
  ioPoints: [{ id: 'p0', name: 'p0', type: 'WORD', iecLocation: '%IW0' }],
  ...over,
})

const tcp = (name: string, over: Partial<ModbusRemoteTcpConfig> = {}): PLCRemoteDevice => ({
  name,
  protocol: 'modbus-tcp',
  modbusTcpConfig: {
    transport: 'tcp',
    host: '10.0.0.5',
    port: 502,
    reconnect: true,
    slaveId: 1,
    timeout: 1000,
    ioGroups: [group()],
    ...over,
  },
})

const rtu = (name: string, over: Partial<ModbusRemoteTcpConfig> = {}): PLCRemoteDevice => ({
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
    ioGroups: [group()],
    ...over,
  },
})

function inputFor(
  target: Target,
  devices: PLCRemoteDevice[],
  over: Partial<CheckInput> = {},
  board: BoardInfo = BOARD_OF[target],
): CheckInput {
  return {
    devices,
    profile: resolveModbusMasterProfile(board, resolveTargetCapabilities(board)),
    board: { serialPorts: board.serialPorts, defaultSerial: board.defaultSerial, rs485Pins: {} },
    rtuServerUart: null,
    networkEnabled: true,
    target,
    hasRemoteDevices: devices.length > 0,
    ...over,
  }
}

const check = (target: Target, devices: PLCRemoteDevice[], over: Partial<CheckInput> = {}, board?: BoardInfo): Issues =>
  checkModbusMaster(inputFor(target, devices, over, board))

const errorsOf = (issues: Issues): Issues => issues.filter((issue) => issue.severity === 'error')

const REMOTE_IO_WARNING_START = 'Your project contains Remote IO configurations'
const REMOTE_IO_WARNING_END = 'The remote device configurations will be ignored during compilation.'
const V4_ONLY_SENTENCE = 'only supported on OpenPLC Runtime v4'

const remoteIoWarnings = (issues: Issues): Issues =>
  issues.filter((issue) => issue.severity === 'warning' && issue.message.includes(REMOTE_IO_WARNING_START))

/** The rows of the rules table a target never runs, all in one project: each would be an error on baremetal. */
const EVERY_BAREMETAL_ONLY_PROBLEM: PLCRemoteDevice[] = [
  tcp('Named', { host: 'plc.local' }),
  rtu('Usb', { serialPort: '/dev/ttyUSB0' }),
  tcp('Zero', { host: '10.0.0.9', port: 0, timeout: 0 }),
]

describe('checkModbusMaster: Reconnect on one endpoint (FR08)', () => {
  it.each<[Target, string]>([
    ['baremetal', '10.0.0.5'],
    ['runtime-v4', 'gateway.local'],
    ['simulator', 'gateway.local'],
  ])('refuses two devices on one endpoint that disagree on Reconnect (%s)', (target, host) => {
    const issues = check(target, [
      tcp('A', { host, reconnect: true }),
      tcp('B', { host, slaveId: 2, reconnect: false }),
    ])

    expect(issues).toContainEqual({
      severity: 'error',
      devices: ['A', 'B'],
      item: expect.stringMatching(/reconnect/i),
      message: `Remote devices "A" and "B" on ${host}:502 disagree on Reconnect.`,
    })
  })

  it('reads a device saved before Reconnect existed as Reconnect on, so it agrees with an explicit on', () => {
    const issues = check('baremetal', [tcp('A', { reconnect: undefined }), tcp('B', { slaveId: 2, reconnect: true })])

    expect(errorsOf(issues)).toEqual([])
  })

  it('reads a device saved before Reconnect existed as Reconnect on, so it disagrees with an explicit off', () => {
    const issues = check('baremetal', [tcp('A', { reconnect: undefined }), tcp('B', { slaveId: 2, reconnect: false })])

    expect(issues).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        devices: ['A', 'B'],
        message: 'Remote devices "A" and "B" on 10.0.0.5:502 disagree on Reconnect.',
      }),
    )
  })

  it('groups two spellings of one IPv4 address as one endpoint on baremetal', () => {
    const issues = check('baremetal', [
      tcp('A', { host: '10.0.0.5', reconnect: true }),
      tcp('B', { host: '10.000.0.05', slaveId: 2, reconnect: false }),
    ])

    expect(issues).toContainEqual(
      expect.objectContaining({ message: 'Remote devices "A" and "B" on 10.0.0.5:502 disagree on Reconnect.' }),
    )
  })

  it('groups a host with spaces around it with the same address written plainly', () => {
    const issues = check('baremetal', [
      tcp('A', { host: ' 10.0.0.5 ', reconnect: true }),
      tcp('B', { host: '10.0.0.5', slaveId: 2, reconnect: false }),
    ])

    expect(issues).toContainEqual(
      expect.objectContaining({ message: 'Remote devices "A" and "B" on 10.0.0.5:502 disagree on Reconnect.' }),
    )
  })

  it('groups two devices with no stored host on the default endpoint 127.0.0.1:502', () => {
    const issues = check('baremetal', [
      tcp('A', { host: undefined, port: undefined, reconnect: true }),
      tcp('B', { host: undefined, port: undefined, slaveId: 2, reconnect: false }),
    ])

    expect(issues).toContainEqual(
      expect.objectContaining({ message: 'Remote devices "A" and "B" on 127.0.0.1:502 disagree on Reconnect.' }),
    )
  })

  it('accepts devices that agree on Reconnect', () => {
    expect(check('baremetal', [tcp('A', { reconnect: false }), tcp('B', { slaveId: 2, reconnect: false })])).toEqual([])
  })

  it('accepts different Reconnect values on different ports of one host', () => {
    const issues = check('baremetal', [tcp('A', { reconnect: true }), tcp('B', { port: 503, reconnect: false })])

    expect(issues).toEqual([])
  })
})

describe('endpointKey: the trimmed host', () => {
  it('keys a baremetal host with spaces around it by the address it holds', () => {
    const config = { transport: 'tcp' as const, host: ' 10.0.0.5 ', port: 502, timeout: 1000, ioGroups: [] }

    expect(endpointKey(config, inputFor('baremetal', []).profile)).toBe('10.0.0.5:502')
  })
})

describe('checkModbusMaster: line settings on one serial port (FR09)', () => {
  it.each<[Target, string]>([
    ['baremetal', 'Serial1'],
    ['runtime-v4', '/dev/ttyUSB0'],
    ['simulator', '/dev/ttyUSB0'],
  ])('refuses two devices on one port that disagree on the baud rate (%s)', (target, serialPort) => {
    const issues = check(target, [
      rtu('A', { serialPort, baudRate: 9600 }),
      rtu('B', { serialPort, baudRate: 19200, slaveId: 2 }),
    ])

    expect(issues).toContainEqual({
      severity: 'error',
      devices: ['A', 'B'],
      item: expect.stringMatching(/baud/i),
      message: expect.stringMatching(
        new RegExp(
          `^Remote devices "A" and "B" on ${serialPort.replace(/\//g, '\\/')} disagree on [^.]*baud[^.]*\\.$`,
          'i',
        ),
      ),
    })
  })

  it.each<[string, Partial<ModbusRemoteTcpConfig>, RegExp]>([
    ['parity', { parity: 'E' }, /parity/i],
    ['stop bits', { stopBits: 2 }, /stop/i],
    ['data bits', { dataBits: 7 }, /data bits/i],
  ])('refuses two devices on one port that disagree on %s', (_setting, change, word) => {
    const issues = check('baremetal', [rtu('A'), rtu('B', { slaveId: 2, ...change })])

    expect(issues).toContainEqual({
      severity: 'error',
      devices: ['A', 'B'],
      item: expect.stringMatching(word),
      message: expect.stringMatching(/^Remote devices "A" and "B" on Serial1 disagree on [^.]+\.$/),
    })
    expect(issues.find((issue) => issue.devices.includes('B'))?.message).toMatch(word)
  })

  it('accepts devices on one port with the same line settings', () => {
    expect(check('baremetal', [rtu('A'), rtu('B', { slaveId: 2 })])).toEqual([])
  })

  it('accepts different line settings on different ports', () => {
    const issues = check('baremetal', [rtu('A'), rtu('B', { serialPort: 'Serial2', baudRate: 19200 })])

    expect(issues).toEqual([])
  })
})

describe("checkModbusMaster: the debugger's and the RTU server's UARTs (FR10)", () => {
  it("refuses an RTU device on the debugger's UART", () => {
    const issues = check('baremetal', [rtu('Pump', { serialPort: 'Serial' })])

    expect(issues).toContainEqual({
      severity: 'error',
      devices: ['Pump'],
      item: expect.any(String),
      message: `Remote device "Pump" uses Serial, the debugger's UART.`,
    })
  })

  it("takes the debugger's UART from the board, not from a fixed name", () => {
    const issues = check('baremetal', [rtu('Pump', { serialPort: 'Serial1' })], {}, DEBUGGER_ON_SERIAL1)

    expect(issues).toContainEqual(
      expect.objectContaining({ message: `Remote device "Pump" uses Serial1, the debugger's UART.` }),
    )
  })

  it("refuses an RTU device on the Modbus RTU server's UART", () => {
    const issues = check('baremetal', [rtu('Pump', { serialPort: 'Serial2' })], { rtuServerUart: 'Serial2' })

    expect(issues).toContainEqual({
      severity: 'error',
      devices: ['Pump'],
      item: expect.any(String),
      message: `Remote device "Pump" uses Serial2, the Modbus RTU server's UART.`,
    })
  })

  it('accepts the same UART when no RTU server is enabled', () => {
    expect(check('baremetal', [rtu('Pump', { serialPort: 'Serial2' })])).toEqual([])
  })

  it('accepts an RTU device on another UART than the RTU server', () => {
    const issues = check('baremetal', [rtu('Pump', { serialPort: 'Serial3' })], { rtuServerUart: 'Serial2' })

    expect(issues).toEqual([])
  })

  it('does not run on Runtime v4', () => {
    const issues = check('runtime-v4', [rtu('Pump', { serialPort: '/dev/ttyUSB0' })], {
      rtuServerUart: '/dev/ttyUSB0',
    })

    expect(errorsOf(issues)).toEqual([])
  })
})

describe('checkModbusMaster: host (FR11)', () => {
  it('refuses a hostname on baremetal, naming the device and the host (TC14)', () => {
    const issues = check('baremetal', [tcp('Pump', { host: 'plc.local' })])

    expect(issues).toContainEqual({
      severity: 'error',
      devices: ['Pump'],
      item: expect.stringMatching(/host/i),
      message: 'Remote device "Pump" does not support the host "plc.local": use an IP address.',
    })
  })

  it('refuses an address with an octet above 255 on baremetal', () => {
    const issues = check('baremetal', [tcp('Pump', { host: '10.0.0.256' })])

    expect(errorsOf(issues)).toContainEqual(
      expect.objectContaining({ devices: ['Pump'], item: expect.stringMatching(/host/i) }),
    )
  })

  it('accepts an IPv4 address surrounded by spaces on baremetal', () => {
    expect(check('baremetal', [tcp('Pump', { host: ' 10.0.0.5 ' })])).toEqual([])
  })

  it('accepts a hostname on Runtime v4', () => {
    expect(check('runtime-v4', [tcp('Pump', { host: 'plc.local' })])).toEqual([])
  })
})

describe('checkModbusMaster: what the target cannot run (FR12)', () => {
  it('refuses an RTU device on a UART the board does not have (TC13)', () => {
    const issues = check('baremetal', [rtu('Pump', { serialPort: 'Serial2' })], {}, UNO)

    expect(issues).toContainEqual({
      severity: 'error',
      devices: ['Pump'],
      item: expect.any(String),
      message: 'Remote device "Pump" does not support Serial2.',
    })
  })

  it('refuses an existing RTU device on a board that offers no RTU (AC02)', () => {
    const issues = check('baremetal', [rtu('Pump', { serialPort: 'Serial2' })], {}, UNO)

    expect(errorsOf(issues).length).toBeGreaterThan(0)
    expect(errorsOf(issues).every((issue) => issue.devices.includes('Pump'))).toBe(true)
  })

  it('refuses a host serial port on baremetal', () => {
    const issues = check('baremetal', [rtu('Pump', { serialPort: '/dev/ttyUSB0' })])

    expect(issues).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        devices: ['Pump'],
        message: 'Remote device "Pump" does not support /dev/ttyUSB0.',
      }),
    )
  })

  it('refuses a TCP device on a board that offers no TCP', () => {
    const issues = check('baremetal', [tcp('Pump')], {}, UNO_WITHOUT_TCP)

    expect(issues).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        devices: ['Pump'],
        message: 'Remote device "Pump" does not support TCP.',
      }),
    )
  })

  it('refuses a TCP device when the network is disabled', () => {
    const issues = check('baremetal', [tcp('Pump')], { networkEnabled: false })

    expect(issues).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        devices: ['Pump'],
        message: 'Remote device "Pump" does not support TCP without the network enabled.',
      }),
    )
  })

  it('accepts a TCP device when the network is enabled', () => {
    expect(check('baremetal', [tcp('Pump')], { networkEnabled: true })).toEqual([])
  })

  it('refuses a transport the Runtime v4 profile does not offer', () => {
    const v4 = inputFor('runtime-v4', [rtu('Pump', { serialPort: '/dev/ttyUSB0' })])
    const issues = checkModbusMaster({ ...v4, profile: { ...v4.profile, transports: ['tcp'] } })

    expect(issues).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        devices: ['Pump'],
        message: 'Remote device "Pump" does not support RTU.',
      }),
    )
  })

  it("accepts a runtime host's serial port on Runtime v4", () => {
    expect(check('runtime-v4', [rtu('Pump', { serialPort: '/dev/ttyUSB0' })])).toEqual([])
  })

  it('runs none of the baremetal-only rows on Runtime v4', () => {
    expect(errorsOf(check('runtime-v4', EVERY_BAREMETAL_ONLY_PROBLEM))).toEqual([])
  })

  it('runs none of the baremetal-only rows on the Simulator', () => {
    expect(errorsOf(check('simulator', EVERY_BAREMETAL_ONLY_PROBLEM))).toEqual([])
  })
})

describe('checkModbusMaster: socket budget (FR13)', () => {
  const endpoints = (count: number): PLCRemoteDevice[] =>
    Array.from({ length: count }, (_, i) => tcp(`D${i}`, { host: `10.0.0.${i + 1}` }))

  it('warns when the TCP endpoints exceed the sockets the board declares (TC15)', () => {
    const issues = check('baremetal', endpoints(5))

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      severity: 'warning',
      message: '5 TCP endpoints exceed the 4 network sockets this board declares.',
    })
    expect(issues[0].item).toEqual(expect.any(String))
  })

  it('stays silent at exactly the declared count', () => {
    expect(check('baremetal', endpoints(4))).toEqual([])
  })

  it('counts devices sharing one endpoint once', () => {
    const issues = check('baremetal', [...endpoints(4), tcp('Second', { host: '10.0.0.1', slaveId: 2 })])

    expect(issues).toEqual([])
  })

  it('does not count RTU devices as endpoints', () => {
    const issues = check('baremetal', [...endpoints(4), rtu('Bus1'), rtu('Bus2', { slaveId: 2 })])

    expect(issues).toEqual([])
  })

  it('stays silent when the board declares no socket count', () => {
    expect(check('baremetal', endpoints(6), {}, MEGA_WITHOUT_BUDGET)).toEqual([])
  })
})

describe('checkModbusMaster: field ranges on baremetal (CRA M4)', () => {
  it.each<[string, PLCRemoteDevice, RegExp]>([
    ['port 0', tcp('Gateway', { port: 0 }), /port/i],
    ['port 65536', tcp('Gateway', { port: 65536 }), /port/i],
    ['slave id 256', tcp('Gateway', { slaveId: 256 }), /slave/i],
    ['slave id -1', tcp('Gateway', { slaveId: -1 }), /slave/i],
    ['timeout 0', tcp('Gateway', { timeout: 0 }), /timeout/i],
    ['timeout 1.5', tcp('Gateway', { timeout: 1.5 }), /timeout/i],
    ['cycle time 0', tcp('Gateway', { ioGroups: [group({ cycleTime: 0 })] }), /cycle/i],
    ['offset abc', tcp('Gateway', { ioGroups: [group({ offset: 'abc' })] }), /offset/i],
    ['offset 65536', tcp('Gateway', { ioGroups: [group({ offset: '65536' })] }), /offset/i],
    ['offset 0x10000', tcp('Gateway', { ioGroups: [group({ offset: '0x10000' })] }), /offset/i],
    ['length 0', tcp('Gateway', { ioGroups: [group({ length: 0, ioPoints: [] })] }), /length/i],
    ['length 2 with one point', tcp('Gateway', { ioGroups: [group({ length: 2 })] }), /length/i],
    [
      'offset 65535 with length 2',
      tcp('Gateway', {
        ioGroups: [
          group({
            offset: '65535',
            length: 2,
            ioPoints: [
              { id: 'p0', name: 'p0', type: 'WORD', iecLocation: '%IW0' },
              { id: 'p1', name: 'p1', type: 'WORD', iecLocation: '%IW1' },
            ],
          }),
        ],
      }),
      /length/i,
    ],
    [
      'an FC 3 point outside %IW',
      tcp('Gateway', {
        ioGroups: [group({ ioPoints: [{ id: 'p0', name: 'p0', type: 'BOOL', iecLocation: '%IX0.0' }] })],
      }),
      /point|address|location|%IX0\.0/i,
    ],
    [
      'an FC 6 point outside %QW',
      tcp('Gateway', {
        ioGroups: [
          group({ functionCode: '6', ioPoints: [{ id: 'p0', name: 'p0', type: 'BOOL', iecLocation: '%QX0.0' }] }),
        ],
      }),
      /point|address|location|%QX0\.0/i,
    ],
    ['baud 0', rtu('Gateway', { baudRate: 0 }), /baud/i],
    ['parity X', rtu('Gateway', { parity: 'X' as ModbusRemoteTcpConfig['parity'] }), /parity/i],
    ['stop bits 3', rtu('Gateway', { stopBits: 3 }), /stop/i],
    ['data bits 6', rtu('Gateway', { dataBits: 6 }), /data bits/i],
  ])('refuses %s, naming the device and the field', (_case, device, field) => {
    const issues = errorsOf(check('baremetal', [device]))

    expect(issues).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        devices: ['Gateway'],
        item: expect.stringMatching(field),
        message: expect.stringMatching(/^Remote device "Gateway"/),
      }),
    )
    expect(issues.find((issue) => field.test(issue.item))?.message).toMatch(field)
  })

  it('accepts every field at its valid boundary', () => {
    const issues = check('baremetal', [
      tcp('Low', { host: '0.0.0.0', port: 1, slaveId: 0, timeout: 1, ioGroups: [group({ cycleTime: 1 })] }),
      tcp('High', {
        host: '255.255.255.255',
        port: 65535,
        slaveId: 255,
        ioGroups: [group({ offset: '65535', length: 1 })],
      }),
      tcp('Hex', { host: '10.0.0.7', ioGroups: [group({ offset: ' 0x10 ' })] }),
      rtu('Seven', { dataBits: 7, stopBits: 2, parity: 'O', baudRate: 115200 }),
    ])

    expect(issues).toEqual([])
  })

  it('accepts the point area of every function code', () => {
    const point = (iecLocation: string) => [{ id: iecLocation, name: iecLocation, type: 'ANY', iecLocation }]
    const issues = check('baremetal', [
      tcp('Gateway', {
        ioGroups: [
          group({ id: 'fc1', functionCode: '1', ioPoints: point('%IX0.0') }),
          group({ id: 'fc2', functionCode: '2', ioPoints: point('%IX0.1') }),
          group({ id: 'fc3', functionCode: '3', ioPoints: point('%IW1') }),
          group({ id: 'fc4', functionCode: '4', ioPoints: point('%IW2') }),
          group({ id: 'fc5', functionCode: '5', ioPoints: point('%QX0.0') }),
          group({ id: 'fc15', functionCode: '15', ioPoints: point('%QX0.1') }),
          group({ id: 'fc6', functionCode: '6', ioPoints: point('%QW0') }),
          group({ id: 'fc16', functionCode: '16', ioPoints: point('%QW1') }),
        ],
      }),
    ])

    expect(issues).toEqual([])
  })

  it('leaves field ranges to the runtime on Runtime v4', () => {
    expect(errorsOf(check('runtime-v4', [tcp('Gateway', { port: 0, timeout: 0 })]))).toEqual([])
  })
})

describe('checkModbusMaster: RS-485 pin of a UART the master uses (CRA M4)', () => {
  it.each(['-1', '2\n#define MBSERIAL_SLAVE 9', 'pa14', ' 22', 'ABC1', '1234'])(
    'refuses the pin %j, naming the UART',
    (pin) => {
      const issues = check('baremetal', [rtu('Pump', { serialPort: 'Serial2' })], {
        board: { serialPorts: MEGA.serialPorts, defaultSerial: 'Serial', rs485Pins: { Serial2: pin } },
      })

      expect(errorsOf(issues)).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          item: expect.stringMatching(/RS-485 pin/i),
          message: expect.stringMatching(/^Serial2: RS-485 pin /),
        }),
      )
    },
  )

  it.each(['22', 'A0', 'PA14'])('accepts the pin %j', (pin) => {
    const issues = check('baremetal', [rtu('Pump', { serialPort: 'Serial2' })], {
      board: { serialPorts: MEGA.serialPorts, defaultSerial: 'Serial', rs485Pins: { Serial2: pin } },
    })

    expect(issues).toEqual([])
  })

  it('refuses a stored pin that is a number, naming the UART and the devices on it', () => {
    const issues = check('baremetal', [rtu('Pump', { serialPort: 'Serial2' })], {
      board: { serialPorts: MEGA.serialPorts, defaultSerial: 'Serial', rs485Pins: { Serial2: 22 } },
    })

    expect(errorsOf(issues)).toEqual([
      {
        severity: 'error',
        devices: ['Pump'],
        item: 'RS-485 pin',
        message: 'Serial2: RS-485 pin 22 is not a pin name such as 22, A0 or PA14.',
      },
    ])
  })

  it('leaves the pin of a UART the master does not use alone', () => {
    const issues = check('baremetal', [rtu('Pump', { serialPort: 'Serial2' })], {
      board: { serialPorts: MEGA.serialPorts, defaultSerial: 'Serial', rs485Pins: { Serial3: '-1' } },
    })

    expect(issues).toEqual([])
  })
})

describe('checkModbusMaster: the Remote IO warning (Runtime v3 and the Simulator)', () => {
  it('only warns on Runtime v3, whatever the devices hold, and drops the v4-only sentence (TC23)', () => {
    const issues = check('runtime-v3', [
      tcp('A', { host: 'plc.local', reconnect: true }),
      tcp('B', { host: 'plc.local', reconnect: false }),
      rtu('C', { serialPort: '/dev/ttyUSB0' }),
    ])

    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe('warning')
    expect(issues[0].message).toContain(REMOTE_IO_WARNING_START)
    expect(issues[0].message).toContain(REMOTE_IO_WARNING_END)
    expect(issues[0].message).not.toContain(V4_ONLY_SENTENCE)
  })

  it('warns on Runtime v3 when the only remote device is not Modbus', () => {
    const issues = check('runtime-v3', [], { hasRemoteDevices: true })

    expect(issues).toHaveLength(1)
    expect(remoteIoWarnings(issues)).toHaveLength(1)
  })

  it('says nothing on Runtime v3 without remote devices', () => {
    expect(check('runtime-v3', [], { hasRemoteDevices: false })).toEqual([])
  })

  it('warns on the Simulator with the same text', () => {
    const warnings = remoteIoWarnings(check('simulator', [tcp('A')]))

    expect(warnings).toHaveLength(1)
    expect(warnings[0].message).toContain(REMOTE_IO_WARNING_END)
    expect(warnings[0].message).not.toContain(V4_ONLY_SENTENCE)
  })

  it('never warns on baremetal', () => {
    expect(remoteIoWarnings(check('baremetal', [tcp('A')], { hasRemoteDevices: true }))).toEqual([])
  })

  it('never warns on Runtime v4', () => {
    expect(remoteIoWarnings(check('runtime-v4', [tcp('A')], { hasRemoteDevices: true }))).toEqual([])
  })
})

describe('checkModbusMaster: remote devices baremetal does not support', () => {
  const ethercat = (name: string): PLCRemoteDevice => ({ name, protocol: 'ethercat' })
  const unsupported = (target: string, names: string): string =>
    `Warning: Your project contains remote devices that ${target} does not support: ${names}. They will be ignored during compilation.`
  const remoteIoItems = (issues: Issues): Issues => issues.filter((issue) => issue.item === 'Remote IO')

  it('warns once about an EtherCAT device, naming it, and nothing else', () => {
    expect(check('baremetal', [ethercat('Slave1')], { hasRemoteDevices: true })).toEqual([
      {
        severity: 'warning',
        item: 'Remote IO',
        devices: ['Slave1'],
        message: unsupported('the selected target', 'Slave1'),
      },
    ])
  })

  it('names the selected target in the warning when it is known', () => {
    const issues = check('baremetal', [ethercat('Slave1')], { hasRemoteDevices: true, boardTarget: 'Arduino Mega' })

    expect(remoteIoItems(issues).map((issue) => issue.message)).toEqual([
      unsupported('the selected target (Arduino Mega)', 'Slave1'),
    ])
  })

  it('gives Modbus devices on baremetal no Remote IO warning', () => {
    expect(remoteIoItems(check('baremetal', [tcp('Pump'), rtu('Drive')], { hasRemoteDevices: true }))).toEqual([])
  })

  it('names only the EtherCAT devices of a mixed project', () => {
    const issues = check('baremetal', [ethercat('Slave1'), tcp('Pump'), ethercat('Slave2')], {
      hasRemoteDevices: true,
    })

    expect(remoteIoItems(issues)).toEqual([
      {
        severity: 'warning',
        item: 'Remote IO',
        devices: ['Slave1', 'Slave2'],
        message: unsupported('the selected target', 'Slave1, Slave2'),
      },
    ])
  })

  it('keeps the Modbus checks of a mixed project', () => {
    const issues = check('baremetal', [ethercat('Slave1'), tcp('Named', { host: 'plc.local' })], {
      hasRemoteDevices: true,
    })

    expect(errorsOf(issues).map((issue) => issue.devices)).toEqual([['Named']])
  })

  it('leaves Runtime v4 without a Remote IO warning for an EtherCAT device', () => {
    expect(remoteIoItems(check('runtime-v4', [ethercat('Slave1')], { hasRemoteDevices: true }))).toEqual([])
  })
})
