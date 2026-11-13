import type {
  BoardInfo,
  ModbusIOGroup,
  ModbusIOPoint,
  ModbusRemoteTcpConfig,
  PLCRemoteDevice,
} from '@root/middleware/shared/ports/types'
import { resolveModbusMasterProfile } from '@root/middleware/shared/utils/modbus-master-profile'
import { resolveTargetCapabilities } from '@root/middleware/shared/utils/target-capabilities'

import { generateModbusMasterHeader } from '../generate-modbus-master-header'

type GeneratorResult = ReturnType<typeof generateModbusMasterHeader>
type Issue = Extract<GeneratorResult, { ok: false }>['issues'][number]

const MEGA: BoardInfo = {
  compiler: 'arduino-cli',
  core: 'arduino:avr',
  platform: 'arduino:avr:mega',
  preview: '',
  specs: {},
  serialPorts: ['Serial', 'Serial1', 'Serial2', 'Serial3'],
  defaultSerial: 'Serial',
  capabilities: { modbusTcpMaster: true, networkSockets: 4 },
  vpp: {
    packageId: 'com.openplc.arduino',
    vendor: 'OpenPLC',
    deviceId: 'mega',
    packagePath: '/packages/com.openplc.arduino',
    screens: { Serial: {}, Network: {} },
    moduleSystem: null,
  },
}

const PROFILE = resolveModbusMasterProfile(MEGA, resolveTargetCapabilities(MEGA))

const point = (iecLocation: string, type = 'WORD'): ModbusIOPoint => ({
  id: iecLocation,
  name: `p_${iecLocation}`,
  type,
  iecLocation,
})

const group = (over: Partial<ModbusIOGroup> = {}): ModbusIOGroup => ({
  id: 'g1',
  name: 'Inputs',
  functionCode: '3',
  cycleTime: 100,
  offset: '0',
  length: 1,
  errorHandling: 'keep-last-value',
  ioPoints: [point('%IW0')],
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

/** Calls the generator for the Mega with the given devices and resolved RS-485 pins. */
function generate(devices: PLCRemoteDevice[], rs485Pins: Record<string, string> = {}): GeneratorResult {
  const board = { serialPorts: MEGA.serialPorts, defaultSerial: MEGA.defaultSerial, rs485Pins }
  return generateModbusMasterHeader({ devices, profile: PROFILE, board, rs485Pins })
}

/** The header of a result that must have one. */
function headerOf(result: GeneratorResult): string {
  if (!result.ok) throw new Error(`expected a header, got issues: ${JSON.stringify(result.issues)}`)
  return result.header
}

/** The issues of a result that must have refused, which then carries no header. */
function issuesOf(result: GeneratorResult): Issue[] {
  if (result.ok) throw new Error(`expected issues, got a header:\n${result.header}`)
  expect(result).not.toHaveProperty('header')
  return result.issues
}

/** What a C compiler sees: lines spliced, then every comment removed. */
function preprocess(header: string): string {
  const source = header.replace(/\\\r?\n/g, '')
  let code = ''
  let i = 0
  while (i < source.length) {
    const pair = source.slice(i, i + 2)
    if (pair === '//') {
      const end = source.indexOf('\n', i)
      i = end === -1 ? source.length : end
      continue
    }
    if (pair === '/*') {
      const end = source.indexOf('*/', i + 2)
      code += ' '
      i = end === -1 ? source.length : end + 2
      continue
    }
    const char = source[i]
    if (char === '"' || char === "'") {
      let j = i + 1
      while (j < source.length && source[j] !== char && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1
      code += source.slice(i, j + 1)
      i = j + 1
      continue
    }
    code += char
    i += 1
  }
  return code
}

/** The value of a macro that must be defined exactly once. */
function defineOf(code: string, name: string): string {
  const matches = [...code.matchAll(new RegExp(`^[ \\t]*#[ \\t]*define[ \\t]+${name}[ \\t]+(.+?)[ \\t]*$`, 'gm'))]
  expect(matches.map((match) => match[0].trim())).toHaveLength(1)
  return matches[0][1]
}

/** Comma-separated parts of a C initializer, ignoring commas inside nested braces. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of text) {
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (char === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  if (current.trim() !== '') parts.push(current.trim())
  return parts.filter((part) => part !== '')
}

/** The inside of a braced initializer. */
function unbrace(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) throw new Error(`not a braced initializer: ${trimmed}`)
  return trimmed.slice(1, -1)
}

/** The rows of a table as field texts, or `null` when the table is not declared. */
function tableRows(code: string, name: string): string[][] | null {
  const declaration = new RegExp(`\\b${name}\\s*\\[[^\\]]*\\]\\s*=\\s*\\{`).exec(code)
  if (!declaration) return null
  const start = declaration.index + declaration[0].length
  let depth = 1
  let i = start
  while (depth > 0 && i < code.length) {
    if (code[i] === '{') depth += 1
    if (code[i] === '}') depth -= 1
    i += 1
  }
  return splitTopLevel(code.slice(start, i - 1)).map((row) =>
    splitTopLevel(unbrace(row)).map((field) => field.replace(/^\.\w+\s*=\s*/, '')),
  )
}

/** A C integer literal as a number. */
function num(text: string): number {
  const cleaned = text
    .trim()
    .replace(/^\(\s*\w+\s*\)\s*/, '')
    .replace(/[uUlL]+$/, '')
  const value = cleaned === '' ? Number.NaN : Number(cleaned)
  if (Number.isNaN(value)) throw new Error(`not a number: ${text}`)
  return value
}

/** A C boolean as written in a table: 1, 0, true or false. */
function flag(text: string): boolean {
  const cleaned = text.trim()
  if (cleaned === '1' || cleaned === 'true') return true
  if (cleaned === '0' || cleaned === 'false') return false
  throw new Error(`not a boolean: ${text}`)
}

interface Endpoint {
  ip: number[]
  port: number
  timeout: number
  reconnect: boolean
}
interface Bus {
  uart: string
  baud: number
  parity: string
  stopBits: number
  dataBits: number
  timeout: number
  pin: string
}
interface Device {
  transport: string
  link: number
  slaveId: number
}
interface Group {
  device: number
  fc: number
  offset: number
  length: number
  cycle: number
  onError: string
  firstPoint: number
}
interface Point {
  image: string
  index: number
  bit: number
}

/** The header's tables, as the firmware will read them. */
function parse(header: string) {
  const code = preprocess(header)
  const rows = (name: string) => tableRows(code, name) ?? []
  return {
    code,
    endpoints: rows('MB_MASTER_ENDPOINTS').map(
      ([ip, port, timeout, reconnect]): Endpoint => ({
        ip: splitTopLevel(unbrace(ip)).map(num),
        port: num(port),
        timeout: num(timeout),
        reconnect: flag(reconnect),
      }),
    ),
    buses: rows('MB_MASTER_BUSES').map(
      ([uart, baud, parity, stopBits, dataBits, timeout, pin]): Bus => ({
        uart: uart.replace(/\s+/g, ''),
        baud: num(baud),
        parity: parity.trim(),
        stopBits: num(stopBits),
        dataBits: num(dataBits),
        timeout: num(timeout),
        pin: pin.trim(),
      }),
    ),
    devices: rows('MB_MASTER_DEVICES').map(
      ([transport, link, slaveId]): Device => ({ transport: transport.trim(), link: num(link), slaveId: num(slaveId) }),
    ),
    groups: rows('MB_MASTER_GROUPS').map(
      ([device, fc, offset, length, cycle, onError, firstPoint]): Group => ({
        device: num(device),
        fc: num(fc),
        offset: num(offset),
        length: num(length),
        cycle: num(cycle),
        onError: onError.trim(),
        firstPoint: num(firstPoint),
      }),
    ),
    points: rows('MB_MASTER_POINTS').map(
      ([image, index, bit]): Point => ({ image: image.trim(), index: num(index), bit: num(bit) }),
    ),
  }
}

const TABLES = [
  ['MB_MASTER_ENDPOINTS', 'MB_MASTER_ENDPOINT_COUNT'],
  ['MB_MASTER_BUSES', 'MB_MASTER_BUS_COUNT'],
  ['MB_MASTER_DEVICES', 'MB_MASTER_DEVICE_COUNT'],
  ['MB_MASTER_GROUPS', 'MB_MASTER_GROUP_COUNT'],
  ['MB_MASTER_POINTS', 'MB_MASTER_POINT_COUNT'],
] as const

const isDeclared = (code: string, table: string): boolean => new RegExp(`\\b${table}\\s*\\[`).test(code)

/** The issue that names `device` (when given) and whose item and message name the field. */
function expectIssue(issues: Issue[], expected: { device?: string; field: RegExp; mentions: string[] }): void {
  const matching = issues.filter(
    (issue) =>
      issue.severity === 'error' &&
      (expected.device === undefined || issue.devices.includes(expected.device)) &&
      expected.field.test(issue.item),
  )
  expect(matching).not.toEqual([])
  for (const text of expected.mentions) {
    expect(matching.some((issue) => issue.message.includes(text))).toBe(true)
  }
}

const TCP_PUMP = tcp('Pump', {
  host: '192.168.1.20',
  port: 1502,
  slaveId: 3,
  timeout: 800,
  reconnect: true,
  ioGroups: [
    group({
      functionCode: '3',
      offset: '0x10',
      length: 2,
      cycleTime: 250,
      ioPoints: [point('%IW3'), point('%IW7')],
    }),
  ],
})

const RTU_DRIVE = rtu('Drive', {
  serialPort: 'Serial1',
  baudRate: 19200,
  parity: 'E',
  stopBits: 1,
  dataBits: 8,
  slaveId: 5,
  timeout: 600,
  ioGroups: [
    group({
      functionCode: '1',
      offset: '0',
      length: 2,
      cycleTime: 50,
      errorHandling: 'set-to-zero',
      ioPoints: [point('%IX0.1', 'BOOL'), point('%IX0.2', 'BOOL')],
    }),
  ],
})

describe('generateModbusMasterHeader: TCP only', () => {
  const header = () => headerOf(generate([TCP_PUMP]))

  it('includes the record types', () => {
    expect(header()).toMatch(/^[ \t]*#[ \t]*include[ \t]+"modbus_master_types\.h"/m)
  })

  it('enables the master and its TCP half only', () => {
    const { code } = parse(header())

    expect(defineOf(code, 'MB_MASTER_ENABLED')).toBe('1')
    expect(defineOf(code, 'MB_MASTER_TCP_ENABLED')).toBe('1')
    expect(defineOf(code, 'MB_MASTER_RTU_ENABLED')).toBe('0')
  })

  it('counts what it emits', () => {
    const { code } = parse(header())

    expect(num(defineOf(code, 'MB_MASTER_ENDPOINT_COUNT'))).toBe(1)
    expect(num(defineOf(code, 'MB_MASTER_BUS_COUNT'))).toBe(0)
    expect(num(defineOf(code, 'MB_MASTER_DEVICE_COUNT'))).toBe(1)
    expect(num(defineOf(code, 'MB_MASTER_GROUP_COUNT'))).toBe(1)
    expect(num(defineOf(code, 'MB_MASTER_POINT_COUNT'))).toBe(2)
  })

  it('emits the endpoint as octets, port, timeout and Reconnect', () => {
    expect(parse(header()).endpoints).toEqual([{ ip: [192, 168, 1, 20], port: 1502, timeout: 800, reconnect: true }])
  })

  it('emits Reconnect off as off', () => {
    const { endpoints } = parse(headerOf(generate([tcp('Pump', { reconnect: false })])))

    expect(endpoints.map((endpoint) => endpoint.reconnect)).toEqual([false])
  })

  it('emits the device on its endpoint with its slave id', () => {
    expect(parse(header()).devices).toEqual([{ transport: 'MB_MASTER_TCP', link: 0, slaveId: 3 }])
  })

  it('emits no bus table', () => {
    expect(isDeclared(parse(header()).code, 'MB_MASTER_BUSES')).toBe(false)
  })
})

describe('generateModbusMasterHeader: RTU only', () => {
  const header = () => headerOf(generate([RTU_DRIVE], { Serial1: '22' }))

  it('enables the master and its RTU half only', () => {
    const { code } = parse(header())

    expect(defineOf(code, 'MB_MASTER_ENABLED')).toBe('1')
    expect(defineOf(code, 'MB_MASTER_TCP_ENABLED')).toBe('0')
    expect(defineOf(code, 'MB_MASTER_RTU_ENABLED')).toBe('1')
    expect(num(defineOf(code, 'MB_MASTER_ENDPOINT_COUNT'))).toBe(0)
    expect(num(defineOf(code, 'MB_MASTER_BUS_COUNT'))).toBe(1)
  })

  it('emits the bus with the board UART, line settings, timeout and RS-485 pin', () => {
    expect(parse(header()).buses).toEqual([
      { uart: '&Serial1', baud: 19200, parity: 'MB_PARITY_E', stopBits: 1, dataBits: 8, timeout: 600, pin: '22' },
    ])
  })

  it('emits MB_MASTER_NO_PIN for a UART without an RS-485 pin', () => {
    const { buses } = parse(headerOf(generate([RTU_DRIVE])))

    expect(buses.map((bus) => bus.pin)).toEqual(['MB_MASTER_NO_PIN'])
  })

  it.each<[ModbusRemoteTcpConfig['parity'], string]>([
    ['N', 'MB_PARITY_N'],
    ['E', 'MB_PARITY_E'],
    ['O', 'MB_PARITY_O'],
  ])('emits parity %s as %s', (parity, identifier) => {
    const { buses } = parse(headerOf(generate([rtu('Drive', { parity })])))

    expect(buses.map((bus) => bus.parity)).toEqual([identifier])
  })

  it('emits the device on its bus with its slave id', () => {
    expect(parse(header()).devices).toEqual([{ transport: 'MB_MASTER_RTU', link: 0, slaveId: 5 }])
  })

  it('emits no endpoint table', () => {
    expect(isDeclared(parse(header()).code, 'MB_MASTER_ENDPOINTS')).toBe(false)
  })
})

describe('generateModbusMasterHeader: TCP and RTU together', () => {
  it('enables both halves and links each device to its own table', () => {
    const { code, endpoints, buses, devices } = parse(headerOf(generate([TCP_PUMP, RTU_DRIVE])))

    expect(defineOf(code, 'MB_MASTER_TCP_ENABLED')).toBe('1')
    expect(defineOf(code, 'MB_MASTER_RTU_ENABLED')).toBe('1')
    expect(devices).toHaveLength(2)
    const pump = devices.find((device) => device.slaveId === 3)
    const drive = devices.find((device) => device.slaveId === 5)
    expect(pump?.transport).toBe('MB_MASTER_TCP')
    expect(endpoints[pump?.link ?? -1]?.ip).toEqual([192, 168, 1, 20])
    expect(drive?.transport).toBe('MB_MASTER_RTU')
    expect(buses[drive?.link ?? -1]?.uart).toBe('&Serial1')
  })
})

describe('generateModbusMasterHeader: one endpoint per host and port (TC02)', () => {
  it('gives two devices on one gateway one endpoint and the smallest timeout', () => {
    const { endpoints, devices } = parse(
      headerOf(
        generate([
          tcp('A', { slaveId: 1, timeout: 1000, reconnect: false }),
          tcp('B', { slaveId: 2, timeout: 300, reconnect: false }),
        ]),
      ),
    )

    expect(endpoints).toEqual([{ ip: [10, 0, 0, 5], port: 502, timeout: 300, reconnect: false }])
    expect(devices).toEqual(
      expect.arrayContaining([
        { transport: 'MB_MASTER_TCP', link: 0, slaveId: 1 },
        { transport: 'MB_MASTER_TCP', link: 0, slaveId: 2 },
      ]),
    )
    expect(devices).toHaveLength(2)
  })

  it('treats two spellings of one address as one endpoint', () => {
    const { endpoints } = parse(
      headerOf(generate([tcp('A', { host: '10.0.0.5' }), tcp('B', { host: '10.000.0.05', slaveId: 2 })])),
    )

    expect(endpoints).toHaveLength(1)
  })

  it('treats a host with spaces around it and the plain address as one endpoint', () => {
    const { endpoints } = parse(
      headerOf(generate([tcp('A', { host: ' 10.0.0.5 ' }), tcp('B', { host: '10.0.0.5', slaveId: 2 })])),
    )

    expect(endpoints.map((endpoint) => endpoint.ip)).toEqual([[10, 0, 0, 5]])
  })

  it('gives devices on different ports of one host their own endpoints', () => {
    const { endpoints, devices } = parse(
      headerOf(generate([tcp('A', { port: 502 }), tcp('B', { port: 503, slaveId: 2 })])),
    )

    expect(endpoints.map((endpoint) => endpoint.port).sort()).toEqual([502, 503])
    const b = devices.find((device) => device.slaveId === 2)
    expect(endpoints[b?.link ?? -1]?.port).toBe(503)
  })

  it('puts a device with no stored host and port on 127.0.0.1:502', () => {
    const { endpoints } = parse(headerOf(generate([tcp('A', { host: undefined, port: undefined })])))

    expect(endpoints).toEqual([{ ip: [127, 0, 0, 1], port: 502, timeout: 1000, reconnect: true }])
  })
})

describe('generateModbusMasterHeader: one bus per serial port', () => {
  it('gives two devices on one UART one bus and the smallest timeout', () => {
    const { buses, devices } = parse(
      headerOf(generate([rtu('A', { timeout: 800 }), rtu('B', { slaveId: 2, timeout: 250 })])),
    )

    expect(buses).toHaveLength(1)
    expect(buses[0].timeout).toBe(250)
    expect(devices.map((device) => device.link)).toEqual([0, 0])
  })

  it('gives devices on two UARTs a bus each', () => {
    const { buses, devices } = parse(
      headerOf(generate([rtu('A', { serialPort: 'Serial1' }), rtu('B', { serialPort: 'Serial3', slaveId: 2 })])),
    )

    expect(buses.map((bus) => bus.uart).sort()).toEqual(['&Serial1', '&Serial3'])
    const b = devices.find((device) => device.slaveId === 2)
    expect(buses[b?.link ?? -1]?.uart).toBe('&Serial3')
  })
})

describe('generateModbusMasterHeader: groups and points', () => {
  const devices = [
    tcp('Pump', {
      ioGroups: [
        group({
          id: 'a',
          functionCode: '3',
          offset: '0x10',
          length: 2,
          cycleTime: 250,
          ioPoints: [point('%IW3'), point('%IW7')],
        }),
        group({
          id: 'b',
          functionCode: '5',
          offset: '8',
          length: 1,
          cycleTime: 20,
          errorHandling: 'set-to-zero',
          ioPoints: [point('%QX1.4', 'BOOL')],
        }),
      ],
    }),
    rtu('Drive', {
      slaveId: 9,
      ioGroups: [
        group({
          id: 'c',
          functionCode: '16',
          offset: '0',
          length: 2,
          cycleTime: 40,
          ioPoints: [point('%QW0'), point('%QW1')],
        }),
        group({
          id: 'd',
          functionCode: '2',
          offset: '65535',
          length: 1,
          cycleTime: 60,
          ioPoints: [point('%IX2.0', 'BOOL')],
        }),
      ],
    }),
  ]
  const parsed = () => parse(headerOf(generate(devices)))

  it('counts every group and point', () => {
    const { code } = parsed()

    expect(num(defineOf(code, 'MB_MASTER_GROUP_COUNT'))).toBe(4)
    expect(num(defineOf(code, 'MB_MASTER_POINT_COUNT'))).toBe(6)
  })

  it('emits each group with its device, function code, offset, length, cycle and error handling', () => {
    const { groups, devices: rows } = parsed()
    const slaveOf = (row: Group) => rows[row.device]?.slaveId

    expect(groups.map((row) => [slaveOf(row), row.fc, row.offset, row.length, row.cycle, row.onError])).toEqual(
      expect.arrayContaining([
        [1, 3, 16, 2, 250, 'MB_ERR_KEEP'],
        [1, 5, 8, 1, 20, 'MB_ERR_ZERO'],
        [9, 16, 0, 2, 40, 'MB_ERR_KEEP'],
        [9, 2, 65535, 1, 60, 'MB_ERR_KEEP'],
      ]),
    )
  })

  it("lists a group's points as length consecutive entries from its first point index", () => {
    const { groups, points } = parsed()
    const pointsOf = (fc: number) => {
      const row = groups.find((candidate) => candidate.fc === fc)
      if (!row) throw new Error(`no group with FC ${fc}`)
      return points.slice(row.firstPoint, row.firstPoint + row.length)
    }

    expect(pointsOf(3).map(({ image, index }) => [image, index])).toEqual([
      ['MB_IMG_IW', 3],
      ['MB_IMG_IW', 7],
    ])
    expect(pointsOf(5)).toEqual([{ image: 'MB_IMG_QX', index: 1, bit: 4 }])
    expect(pointsOf(16).map(({ image, index }) => [image, index])).toEqual([
      ['MB_IMG_QW', 0],
      ['MB_IMG_QW', 1],
    ])
    expect(pointsOf(2)).toEqual([{ image: 'MB_IMG_IX', index: 2, bit: 0 }])
  })

  it('emits the bits of an RTU coil group', () => {
    const { points } = parse(headerOf(generate([RTU_DRIVE])))

    expect(points).toEqual([
      { image: 'MB_IMG_IX', index: 0, bit: 1 },
      { image: 'MB_IMG_IX', index: 0, bit: 2 },
    ])
  })
})

describe('generateModbusMasterHeader: tables', () => {
  it('declares every emitted table static const', () => {
    const { code } = parse(headerOf(generate([TCP_PUMP, RTU_DRIVE])))

    for (const [table] of TABLES) {
      const declarations = code
        .split('\n')
        .filter((line) => new RegExp(`\\b${table}\\s*\\[`).test(line) && line.includes('='))
      expect(declarations).toHaveLength(1)
      expect(declarations[0]).toMatch(new RegExp(`^\\s*static\\s+const\\s+mb_master_\\w+_t\\s+${table}\\s*\\[`))
    }
  })

  it('emits as many rows as each count says', () => {
    const { code } = parse(headerOf(generate([TCP_PUMP, RTU_DRIVE])))

    for (const [table, count] of TABLES) {
      expect(tableRows(code, table)).toHaveLength(num(defineOf(code, count)))
    }
  })

  it('emits no table whose count is 0, and the count macro says 0', () => {
    const { code } = parse(headerOf(generate([tcp('Idle', { ioGroups: [] })])))

    expect(num(defineOf(code, 'MB_MASTER_GROUP_COUNT'))).toBe(0)
    expect(num(defineOf(code, 'MB_MASTER_POINT_COUNT'))).toBe(0)
    expect(num(defineOf(code, 'MB_MASTER_BUS_COUNT'))).toBe(0)
    expect(isDeclared(code, 'MB_MASTER_GROUPS')).toBe(false)
    expect(isDeclared(code, 'MB_MASTER_POINTS')).toBe(false)
    expect(isDeclared(code, 'MB_MASTER_BUSES')).toBe(false)
  })
})

describe('generateModbusMasterHeader: project text stays inside comments', () => {
  const HOSTILE_DEVICE = 'Pump */ int injected_a = 1; /*\n#define MB_MASTER_ENABLED 0\n// '
  const HOSTILE_GROUP = 'Inputs\r\n#error injected_b'

  it('keeps a hostile device and group name out of the code', () => {
    const header = headerOf(
      generate([tcp(HOSTILE_DEVICE, { ioGroups: [group({ name: HOSTILE_GROUP })] }), rtu('Drive')]),
    )
    const { code } = parse(header)

    expect(code).not.toContain('injected_a')
    expect(code).not.toContain('injected_b')
    expect(code).not.toMatch(/#\s*error/)
    expect(defineOf(code, 'MB_MASTER_ENABLED')).toBe('1')
  })

  it('keeps a device name ending in a backslash from swallowing the next line', () => {
    const header = headerOf(generate([tcp('Pump\\', { ioGroups: [group({ name: 'Inputs\\' })] })]))
    const { code } = parse(header)

    expect(defineOf(code, 'MB_MASTER_ENABLED')).toBe('1')
    for (const [table, count] of TABLES) {
      const expected = num(defineOf(code, count))
      if (expected > 0) expect(tableRows(code, table)).toHaveLength(expected)
    }
  })
})

describe('generateModbusMasterHeader: field validation of its own (CRA M4)', () => {
  it.each<[string, Partial<ModbusRemoteTcpConfig>, (parsed: ReturnType<typeof parse>) => unknown, unknown]>([
    ['a host with spaces around it', { host: ' 10.0.0.5 ' }, (p) => p.endpoints[0]?.ip, [10, 0, 0, 5]],
    ['a host with a zero-padded octet', { host: '010.0.0.1' }, (p) => p.endpoints[0]?.ip, [10, 0, 0, 1]],
    ['the lowest port', { port: 1 }, (p) => p.endpoints[0]?.port, 1],
    ['the lowest timeout', { timeout: 1 }, (p) => p.endpoints[0]?.timeout, 1],
    ['slave id 0', { slaveId: 0 }, (p) => p.devices[0]?.slaveId, 0],
    ['slave id 255', { slaveId: 255 }, (p) => p.devices[0]?.slaveId, 255],
    ['the lowest cycle time', { ioGroups: [group({ cycleTime: 1 })] }, (p) => p.groups[0]?.cycle, 1],
    ['a hex offset', { ioGroups: [group({ offset: '0x10' })] }, (p) => p.groups[0]?.offset, 16],
    ['a decimal offset with spaces', { ioGroups: [group({ offset: ' 100 ' })] }, (p) => p.groups[0]?.offset, 100],
  ])('accepts %s and emits it as a number', (_case, change, read, expected) => {
    expect(read(parse(headerOf(generate([tcp('Gateway', change)]))))).toEqual(expected)
  })

  it.each<[string, Partial<ModbusRemoteTcpConfig>, (parsed: ReturnType<typeof parse>) => unknown, unknown]>([
    ['data bits 7', { dataBits: 7 }, (p) => p.buses[0]?.dataBits, 7],
    ['stop bits 2', { stopBits: 2 }, (p) => p.buses[0]?.stopBits, 2],
    ['baud 115200', { baudRate: 115200 }, (p) => p.buses[0]?.baud, 115200],
  ])('accepts RTU %s and emits it as a number', (_case, change, read, expected) => {
    expect(read(parse(headerOf(generate([rtu('Gateway', change)]))))).toEqual(expected)
  })

  it.each<[string, PLCRemoteDevice, RegExp]>([
    ['a host with three octets', tcp('Gateway', { host: '10.0.0' }), /host/i],
    ['a host with five octets', tcp('Gateway', { host: '1.2.3.4.5' }), /host/i],
    ['a hostname (TC14)', tcp('Gateway', { host: 'plc.local' }), /host/i],
    ['an empty host', tcp('Gateway', { host: '' }), /host/i],
    ['port 65536', tcp('Gateway', { port: 65536 }), /port/i],
    ['port 1.5', tcp('Gateway', { port: 1.5 }), /port/i],
    ['slave id 256', tcp('Gateway', { slaveId: 256 }), /slave/i],
    ['slave id -1', tcp('Gateway', { slaveId: -1 }), /slave/i],
    ['slave id 1.5', tcp('Gateway', { slaveId: 1.5 }), /slave/i],
    ['cycle time 0', tcp('Gateway', { ioGroups: [group({ cycleTime: 0 })] }), /cycle/i],
    ['cycle time 2.5', tcp('Gateway', { ioGroups: [group({ cycleTime: 2.5 })] }), /cycle/i],
    ['offset -1', tcp('Gateway', { ioGroups: [group({ offset: '-1' })] }), /offset/i],
    ['offset 1e3', tcp('Gateway', { ioGroups: [group({ offset: '1e3' })] }), /offset/i],
    ['offset 65536', tcp('Gateway', { ioGroups: [group({ offset: '65536' })] }), /offset/i],
    ['offset 0x10000', tcp('Gateway', { ioGroups: [group({ offset: '0x10000' })] }), /offset/i],
    ['an empty offset', tcp('Gateway', { ioGroups: [group({ offset: '' })] }), /offset/i],
    ['length 1.5', tcp('Gateway', { ioGroups: [group({ length: 1.5 })] }), /length/i],
    [
      'an FC 1 point outside %IX',
      tcp('Gateway', { ioGroups: [group({ functionCode: '1', ioPoints: [point('%IW0')] })] }),
      /point|address|location|%IW0/i,
    ],
    [
      'an FC 15 point outside %QX',
      tcp('Gateway', { ioGroups: [group({ functionCode: '15', ioPoints: [point('%QW0')] })] }),
      /point|address|location|%QW0/i,
    ],
    ['a UART the board does not have', rtu('Gateway', { serialPort: 'Serial9' }), /port|uart|serial/i],
    ['a UART name carrying code', rtu('Gateway', { serialPort: 'Serial1; abort()' }), /port|uart|serial/i],
    ['a host serial port', rtu('Gateway', { serialPort: '/dev/ttyUSB0' }), /port|uart|serial/i],
    ['baud 0', rtu('Gateway', { baudRate: 0 }), /baud/i],
    ['baud -9600', rtu('Gateway', { baudRate: -9600 }), /baud/i],
    ['baud 9600.5', rtu('Gateway', { baudRate: 9600.5 }), /baud/i],
    ['parity X', rtu('Gateway', { parity: 'X' as ModbusRemoteTcpConfig['parity'] }), /parity/i],
    ['stop bits 0', rtu('Gateway', { stopBits: 0 }), /stop/i],
    ['stop bits 3', rtu('Gateway', { stopBits: 3 }), /stop/i],
    ['data bits 6', rtu('Gateway', { dataBits: 6 }), /data bits/i],
    ['data bits 9', rtu('Gateway', { dataBits: 9 }), /data bits/i],
  ])('refuses %s with an issue naming the device and the field', (_case, device, field) => {
    expectIssue(issuesOf(generate([device])), { device: 'Gateway', field, mentions: ['Gateway'] })
  })

  it.each(['-1', 'pa14', ' 22', '2\n#define MBSERIAL_SLAVE 9'])(
    'refuses the RS-485 pin %j of a UART the master uses, naming the UART',
    (pin) => {
      expectIssue(issuesOf(generate([rtu('Drive', { serialPort: 'Serial2' })], { Serial2: pin })), {
        field: /RS-485 pin/i,
        mentions: ['Serial2', 'RS-485 pin'],
      })
    },
  )

  it.each(['22', 'A0', 'PA14'])('emits the RS-485 pin %j as given', (pin) => {
    const { buses } = parse(headerOf(generate([rtu('Drive', { serialPort: 'Serial2' })], { Serial2: pin })))

    expect(buses.map((bus) => bus.pin)).toEqual([pin])
  })
})

describe('generateModbusMasterHeader: abuse scenario AS-05', () => {
  const baseline = (over: Partial<ModbusRemoteTcpConfig> = {}): PLCRemoteDevice =>
    tcp('Gateway', {
      host: '10.0.0.1',
      port: 502,
      slaveId: 1,
      timeout: 1000,
      reconnect: true,
      ioGroups: [group({ functionCode: '3', offset: '0', length: 2, ioPoints: [point('%IW0'), point('%IW1')] })],
      ...over,
    })
  const SERVER_PINS = { Serial1: '2' }

  it('generates a header for the scenario project as given', () => {
    expect(generate([baseline()], SERVER_PINS).ok).toBe(true)
  })

  it.each<[string, Partial<ModbusRemoteTcpConfig>, RegExp, string]>([
    ['host 10.0.0.1"; while(1); //', { host: '10.0.0.1"; while(1); //' }, /host/i, 'host'],
    ['host 10.0.0.300', { host: '10.0.0.300' }, /host/i, 'host'],
    ['group offset 0); abort(', { ioGroups: [group({ offset: '0); abort(', length: 1 })] }, /offset/i, 'offset'],
    ['group length 0', { ioGroups: [group({ length: 0, ioPoints: [] })] }, /length/i, 'length'],
    [
      'group length 65535 with offset 100',
      { ioGroups: [group({ offset: '100', length: 65535, ioPoints: [point('%IW0'), point('%IW1')] })] },
      /length/i,
      'length',
    ],
    [
      'group length 125 with points allocated to %IW0 and %IW1 only',
      { ioGroups: [group({ offset: '0', length: 125, ioPoints: [point('%IW0'), point('%IW1')] })] },
      /length/i,
      'length',
    ],
    ['port 0', { port: 0 }, /port/i, 'port'],
    ['port 70000', { port: 70000 }, /port/i, 'port'],
    ['timeout 0', { timeout: 0 }, /timeout/i, 'timeout'],
    ['timeout -1', { timeout: -1 }, /timeout/i, 'timeout'],
    ['timeout 1.5', { timeout: 1.5 }, /timeout/i, 'timeout'],
  ])('refuses %s with an error naming "Gateway" and the field, and no header', (_row, change, field, word) => {
    const issues = issuesOf(generate([baseline(change)], SERVER_PINS))

    expectIssue(issues, { device: 'Gateway', field, mentions: ['Gateway'] })
    expect(issues.some((issue) => issue.message.toLowerCase().includes(word))).toBe(true)
  })

  it.each(['2\n#define MBSERIAL_SLAVE 9', '-1'])(
    'refuses the RS-485 pin %j of Serial1 with an error naming Serial1 and the RS-485 pin, and no header',
    (pin) => {
      expectIssue(issuesOf(generate([baseline()], { Serial1: pin })), {
        field: /RS-485 pin/i,
        mentions: ['Serial1', 'RS-485 pin'],
      })
    },
  )

  it('generates a header with offset 65535 and length 1', () => {
    const { groups } = parse(
      headerOf(
        generate(
          [baseline({ ioGroups: [group({ offset: '65535', length: 1, ioPoints: [point('%IW0')] })] })],
          SERVER_PINS,
        ),
      ),
    )

    expect(groups.map(({ offset, length }) => ({ offset, length }))).toEqual([{ offset: 65535, length: 1 }])
  })

  it('generates a header with port 65535', () => {
    const { endpoints } = parse(headerOf(generate([baseline({ port: 65535 })], SERVER_PINS)))

    expect(endpoints.map((endpoint) => endpoint.port)).toEqual([65535])
  })
})
