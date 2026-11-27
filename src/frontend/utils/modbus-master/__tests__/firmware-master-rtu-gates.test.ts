import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import type { BoardInfo, ModbusIOGroup, PLCRemoteDevice } from '@root/middleware/shared/ports/types'
import { resolveModbusMasterProfile } from '@root/middleware/shared/utils/modbus-master-profile'
import { resolveTargetCapabilities } from '@root/middleware/shared/utils/target-capabilities'

import { generateModbusMasterHeader } from '../generate-modbus-master-header'

const FIRMWARE_ROOTS = [
  join(__dirname, '..', '..', '..', '..', '..', 'resources', 'sources'),
  join(__dirname, '..', '..', '..', '..', 'assets', 'firmware'),
]

const FIRMWARE_ROOT =
  FIRMWARE_ROOTS.find((candidate) => existsSync(join(candidate, 'arduino', 's7comm_config.h'))) ?? FIRMWARE_ROOTS[0]

const BAREMETAL_DIR = join(FIRMWARE_ROOT, 'Baremetal')
const ARDUINO_DIR = join(FIRMWARE_ROOT, 'arduino')

const ESP32: BoardInfo = {
  compiler: 'arduino-cli',
  core: 'esp32:esp32',
  preview: '',
  specs: {},
  serialPorts: ['Serial', 'Serial1', 'Serial2'],
  defaultSerial: 'Serial',
  capabilities: { modbusTcpMaster: true },
}

const PROFILE = resolveModbusMasterProfile(ESP32, resolveTargetCapabilities(ESP32))

const GROUP: ModbusIOGroup = {
  id: 'g1',
  name: 'G1',
  functionCode: '3',
  cycleTime: 100,
  offset: '0',
  length: 2,
  errorHandling: 'set-to-zero',
  ioPoints: [
    { id: 'g1_0', name: 'g1_0', type: 'WORD', iecLocation: '%IW100' },
    { id: 'g1_1', name: 'g1_1', type: 'WORD', iecLocation: '%IW101' },
  ],
}

const RTU_SLAVE: PLCRemoteDevice = {
  name: 'Drive',
  protocol: 'modbus-tcp',
  modbusTcpConfig: {
    transport: 'rtu',
    serialPort: 'Serial1',
    baudRate: 19200,
    parity: 'N',
    stopBits: 1,
    dataBits: 8,
    slaveId: 1,
    timeout: 500,
    ioGroups: [GROUP],
  },
}

/** The `modbus_master_config.h` a baremetal build writes for one RTU device on `Serial1` with an RS-485 pin. */
function rtuConfig(): string {
  const generated = generateModbusMasterHeader({
    devices: [RTU_SLAVE],
    profile: PROFILE,
    board: { serialPorts: ESP32.serialPorts, defaultSerial: ESP32.defaultSerial },
    rs485Pins: { Serial1: '4' },
  })
  if (!generated.ok) throw new Error(`the fixture was refused: ${JSON.stringify(generated.issues)}`)
  return generated.header
}

/** The `modbus_master_config.h` for one RTU device on `Serial1` whose bus has RS-485 enable pin 22. */
function rtuConfigWithPin22(): string {
  const generated = generateModbusMasterHeader({
    devices: [RTU_SLAVE],
    profile: PROFILE,
    board: { serialPorts: ESP32.serialPorts, defaultSerial: ESP32.defaultSerial },
    rs485Pins: { Serial1: '22' },
  })
  if (!generated.ok) throw new Error(`the fixture was refused: ${JSON.stringify(generated.issues)}`)
  return generated.header
}

/** The `modbus_master_config.h` for one TCP device and no RTU bus. */
function tcpOnlyConfig(): string {
  const generated = generateModbusMasterHeader({
    devices: [
      {
        name: 'Meter',
        protocol: 'modbus-tcp',
        modbusTcpConfig: {
          transport: 'tcp',
          host: '192.168.1.50',
          port: 502,
          reconnect: true,
          slaveId: 1,
          timeout: 500,
          ioGroups: [GROUP],
        },
      },
    ],
    profile: PROFILE,
    board: { serialPorts: ESP32.serialPorts, defaultSerial: ESP32.defaultSerial },
    rs485Pins: { Serial1: '22' },
  })
  if (!generated.ok) throw new Error(`the fixture was refused: ${JSON.stringify(generated.issues)}`)
  return generated.header
}

/** The macro a stand-in for a missing system or library header defines, e.g. `Controllino.h` gives `STAND_IN_CONTROLLINO_H`. */
const standInMacro = (header: string): string => `STAND_IN_${header.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`

interface Build {
  /** The generated `defines.h`: board identity, debugger, server. */
  defines: string[]
  /** `modbus_master_config.h` as the build writes it. */
  masterConfig: string
}

/**
 * Runs the C preprocessor over `source` as a baremetal build would see it: the
 * build's own headers first, then `Baremetal/`, then `arduino/`. Every header
 * the host does not have (Arduino, the CONTROLLINO core) becomes an empty
 * stand-in that only defines `standInMacro(name)`.
 */
function preprocess(source: string, build: Build): string {
  const root = mkdtempSync(join(tmpdir(), 'mb-master-rtu-gates-'))
  try {
    const own = join(root, 'build')
    const standIns = join(root, 'stand-ins')
    mkdirSync(own)
    mkdirSync(standIns)
    writeFileSync(join(own, 'defines.h'), `${build.defines.map((name) => `#define ${name}`).join('\n')}\n`)
    writeFileSync(join(own, 'modbus_master_config.h'), build.masterConfig)
    const input = join(own, 'tu.cpp')
    writeFileSync(input, source)

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const run = spawnSync(
        'g++',
        [
          '-E',
          '-x',
          'c++',
          '-std=gnu++17',
          '-iquote',
          own,
          '-iquote',
          BAREMETAL_DIR,
          '-iquote',
          ARDUINO_DIR,
          '-I',
          standIns,
          input,
        ],
        { encoding: 'utf-8', env: { ...process.env, LC_ALL: 'C', LANG: 'C' }, maxBuffer: 64 * 1024 * 1024 },
      )
      if (run.status === 0) return run.stdout
      const output = `${run.stderr ?? ''}${run.error?.message ?? ''}`
      const missing = /fatal error: ([^:\s]+): No such file or directory/.exec(output)?.[1]
      if (missing === undefined) throw new Error(`the preprocessor failed:\n${output}`)
      const standIn = join(standIns, missing)
      mkdirSync(dirname(standIn), { recursive: true })
      writeFileSync(standIn, `#pragma once\n#define ${standInMacro(missing)} 1\n`)
    }
    throw new Error('the preprocessor kept asking for headers')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/** A translation unit that includes `Baremetal/<name>`, refused when the file is absent so no stand-in hides it. */
function including(...files: string[]): string {
  for (const name of files) {
    if (!existsSync(join(BAREMETAL_DIR, name))) throw new Error(`Baremetal/${name} does not exist`)
  }
  return files.map((name) => `#include "${name}"\n`).join('')
}

/** The body of `void name()` in preprocessed code, without its braces, or `null` when it is not defined. */
function functionBody(code: string, name: string): string | null {
  const start = new RegExp(`\\bvoid\\s+${name}\\s*\\(\\s*(void)?\\s*\\)\\s*\\{`).exec(code)
  if (start === null) return null
  let depth = 1
  let index = start.index + start[0].length
  const bodyStart = index
  while (index < code.length && depth > 0) {
    if (code[index] === '{') depth += 1
    if (code[index] === '}') depth -= 1
    index += 1
  }
  return code.slice(bodyStart, index - 1)
}

/** Offsets of every call of `name` in `body`. */
const callsOf = (body: string, name: string): number[] =>
  [...body.matchAll(new RegExp(`\\b${name}\\s*\\(`, 'g'))].map((match) => match.index ?? -1)

/** Which of `identifiers` appear in preprocessed code. */
const named = (code: string, identifiers: string[]): string[] =>
  identifiers.filter((identifier) => new RegExp(`\\b${identifier}\\b`).test(code))

const describeOnHost = process.env.MB_MASTER_HOST_COMPILE === '1' ? describe : describe.skip

describeOnHost('Baremetal.ino with an RTU-only master and no Modbus or S7 server', () => {
  const code = (): string =>
    preprocess(including('Baremetal.ino'), { defines: ['BOARD_ESP32', 'DEBUGGER_ENABLED'], masterConfig: rtuConfig() })

  it('runs mb_master_task() from scheduler()', () => {
    expect(callsOf(functionBody(code(), 'scheduler') ?? '', 'mb_master_task').length).toBeGreaterThan(0)
  })

  it('runs mb_master_task() from the inter-cycle slack in loop()', () => {
    expect(callsOf(functionBody(code(), 'loop') ?? '', 'mb_master_task').length).toBeGreaterThan(0)
  })

  it.each(['scheduler', 'loop'])('re-imposes the forces in %s() after the master', (name) => {
    const body = functionBody(code(), name) ?? ''
    const master = callsOf(body, 'mb_master_task')
    const forces = callsOf(body, 'runtime_apply_located_forces')
    expect(master.length).toBeGreaterThan(0)
    expect(Math.max(...forces)).toBeGreaterThan(Math.max(...master))
  })

  it('maps the empty buffers in setup() (V7)', () => {
    const preprocessed = code()
    expect({
      called: callsOf(functionBody(preprocessed, 'setup') ?? '', 'mapEmptyBuffers').length > 0,
      defined: functionBody(preprocessed, 'mapEmptyBuffers') !== null,
    }).toEqual({ called: true, defined: true })
  })
})

describeOnHost('modbus_rs485 keeps the CONTROLLINO RS-485 branches of the server', () => {
  const CHIP_CALLS = ['Controllino_RS485Init', 'Controllino_RS485TxEnable', 'Controllino_RS485RxEnable']
  const MICRO_PINS = ['CUSTOM_RS485_DEFAULT_DE_PIN', 'CUSTOM_RS485_DEFAULT_RE_PIN']
  const CHIP_BOARDS = ['CONTROLLINO_MAXI', 'CONTROLLINO_MEGA']

  const helper = (board: string[]): string =>
    preprocess(including('modbus_rs485.h', 'modbus_rs485.cpp'), {
      defines: [...board, 'MODBUS_ENABLED', 'MBSERIAL', 'DEBUGGER_ENABLED'],
      masterConfig: rtuConfig(),
    })

  it.each(CHIP_BOARDS)('%s drives the RS-485 chip through its calls on Serial3', (board) => {
    const code = helper([board])
    expect({ calls: named(code, CHIP_CALLS), serial3: named(code, ['Serial3']) }).toEqual({
      calls: CHIP_CALLS,
      serial3: ['Serial3'],
    })
  })

  it('CONTROLLINO_MICRO drives its DE and RE pins on Serial2, not the CONTROLLINO calls', () => {
    const code = helper(['CONTROLLINO_MICRO'])
    expect({
      pins: named(code, MICRO_PINS),
      calls: named(code, CHIP_CALLS),
      serial2: named(code, ['Serial2']),
    }).toEqual({
      pins: MICRO_PINS,
      calls: [],
      serial2: ['Serial2'],
    })
  })

  it('any other board keeps only the generic enable pin path', () => {
    expect(named(helper(['BOARD_ESP32']), [...CHIP_CALLS, ...MICRO_PINS])).toEqual([])
  })
})

describeOnHost("Baremetal.ino keeps the master's RS-485 enable pins out of the HAL pin masks (P08-D5)", () => {
  const MASKS = ['pinMask_DIN', 'pinMask_AIN', 'pinMask_DOUT', 'pinMask_AOUT']

  const afterHardwareInit = (masterConfig: string): string => {
    const setup =
      functionBody(
        preprocess(including('Baremetal.ino'), { defines: ['BOARD_ESP32', 'DEBUGGER_ENABLED'], masterConfig }),
        'setup',
      ) ?? ''
    const init = callsOf(setup, 'hardwareInit')
    if (init.length === 0) throw new Error('setup() does not call hardwareInit()')
    return setup.slice(Math.max(...init))
  }

  it('reads every bus RS-485 pin from MB_MASTER_BUSES after hardwareInit()', () => {
    const tail = afterHardwareInit(rtuConfigWithPin22())
    expect(named(tail, ['MB_MASTER_BUSES', 'rs485_pin'])).toEqual(['MB_MASTER_BUSES', 'rs485_pin'])
  })

  it.each(MASKS)('sets to 255 the %s elements equal to a bus RS-485 pin after hardwareInit()', (mask) => {
    const tail = afterHardwareInit(rtuConfigWithPin22())
    expect(tail).toMatch(new RegExp(`\\b${mask}\\s*\\[[^\\]]*\\]\\s*=\\s*255\\b`))
  })

  it('names no MB_MASTER_BUSES in setup() with the skeleton stub', () => {
    const stub = readFileSync(join(ARDUINO_DIR, 'modbus_master_config.h'), 'utf-8')
    expect(named(afterHardwareInit(stub), ['MB_MASTER_BUSES'])).toEqual([])
  })

  it('names no MB_MASTER_BUSES in setup() for a TCP-only master', () => {
    expect(named(afterHardwareInit(tcpOnlyConfig()), ['MB_MASTER_BUSES'])).toEqual([])
  })
})
