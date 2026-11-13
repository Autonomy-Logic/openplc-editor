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

const MEGA: BoardInfo = {
  compiler: 'arduino-cli',
  core: 'arduino:avr',
  preview: '',
  specs: {},
  serialPorts: ['Serial', 'Serial1', 'Serial2', 'Serial3'],
  defaultSerial: 'Serial',
  capabilities: { modbusTcpMaster: true, networkSockets: 4 },
}

const PROFILE = resolveModbusMasterProfile(MEGA, resolveTargetCapabilities(MEGA))

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

const TCP_SLAVE: PLCRemoteDevice = {
  name: 'Slave',
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
}

const RTU_SLAVE: PLCRemoteDevice = {
  name: 'Drive',
  protocol: 'modbus-tcp',
  modbusTcpConfig: {
    transport: 'rtu',
    serialPort: 'Serial1',
    baudRate: 19200,
    parity: 'E',
    stopBits: 1,
    dataBits: 8,
    slaveId: 1,
    timeout: 500,
    ioGroups: [GROUP],
  },
}

/** The `modbus_master_config.h` a baremetal build writes for `devices`. */
function generatedConfig(devices: PLCRemoteDevice[]): string {
  const generated = generateModbusMasterHeader({
    devices,
    profile: PROFILE,
    board: { serialPorts: MEGA.serialPorts, defaultSerial: MEGA.defaultSerial },
    rs485Pins: {},
  })
  if (!generated.ok) throw new Error(`the fixture was refused: ${JSON.stringify(generated.issues)}`)
  return generated.header
}

const STUB_CONFIG = (): string => readFileSync(join(ARDUINO_DIR, 'modbus_master_config.h'), 'utf-8')
const TCP_CONFIG = (): string => generatedConfig([TCP_SLAVE])
const RTU_CONFIG = (): string => generatedConfig([RTU_SLAVE])

const S7_ON =
  '#ifndef S7COMM_CONFIG_H\n#define S7COMM_CONFIG_H\n#define S7COMM_ENABLED 1\n#define S7COMM_MAX_CLIENTS 2\n#endif\n'

/** The macro a stand-in for a missing system or library header defines, e.g. `WiFiNINA.h` gives `STAND_IN_WIFININA_H`. */
const standInMacro = (header: string): string => `STAND_IN_${header.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`

interface Build {
  /** The generated `defines.h`: board identity and network kind. */
  defines: string[]
  /** `modbus_master_config.h` as the build writes it. */
  masterConfig: string
  /** Overrides of the protocol config stubs in `arduino/`, by file name. */
  configs?: Record<string, string>
}

/**
 * Runs the C preprocessor over `entry` as a baremetal build would see it: the
 * build's own headers first, then `Baremetal/`, then `arduino/`. Every header
 * the host does not have (Arduino, the network libraries) becomes an empty
 * stand-in that only defines `standInMacro(name)`, so the output says which
 * ones the firmware pulled in. `-dM` returns the macros instead of the code.
 */
function preprocess(entry: { file: string } | { source: string }, build: Build, dumpMacros: boolean): string {
  const root = mkdtempSync(join(tmpdir(), 'mb-master-gates-'))
  try {
    const own = join(root, 'build')
    const standIns = join(root, 'stand-ins')
    mkdirSync(own)
    mkdirSync(standIns)
    writeFileSync(join(own, 'defines.h'), `${build.defines.map((name) => `#define ${name}`).join('\n')}\n`)
    writeFileSync(join(own, 'modbus_master_config.h'), build.masterConfig)
    for (const [name, content] of Object.entries(build.configs ?? {})) writeFileSync(join(own, name), content)

    let input: string
    if ('file' in entry) {
      input = entry.file
    } else {
      input = join(own, 'tu.cpp')
      writeFileSync(input, entry.source)
    }

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const run = spawnSync(
        'g++',
        [
          '-E',
          ...(dumpMacros ? ['-dM'] : []),
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

/** Whether `macro` is defined in a `-dM` dump. */
const defines = (dump: string, macro: string): boolean => new RegExp(`^#define ${macro}\\b`, 'm').test(dump)

/** Which of the two Wi-Fi library headers a `-dM` dump pulled in. */
const wifiHeaders = (dump: string): { wifiNina: boolean; wifi: boolean } => ({
  wifiNina: defines(dump, standInMacro('WiFiNINA.h')),
  wifi: defines(dump, standInMacro('WiFi.h')),
})

const NET_PROBE = `#include "baremetal_net.h"
#if BM_NET_ENABLED
#define PROBE_BM_NET_ON 1
#endif
`

/** The macros of a translation unit that includes only `baremetal_net.h`. */
const netSeam = (build: Build): string => preprocess({ source: NET_PROBE }, build, true)

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

const SKETCH = { file: join(BAREMETAL_DIR, 'Baremetal.ino') }

/** Baremetal.ino preprocessed for an ESP32 with the network up and the debugger on, as a baremetal build sees it. */
const sketch = (masterConfig: string, extra: string[] = []): string =>
  preprocess(
    SKETCH,
    { defines: ['BOARD_ESP32', 'DEBUGGER_ENABLED', 'MBTCP_WIFI', 'OPLC_NET_ENABLED', ...extra], masterConfig },
    false,
  )

const describeOnHost = process.env.MB_MASTER_HOST_COMPILE === '1' ? describe : describe.skip

describeOnHost('baremetal_net.h, the network seam', () => {
  it('opens for a TCP master alone, reading modbus_master_config.h itself', () => {
    expect(defines(netSeam({ defines: ['BOARD_ESP32'], masterConfig: TCP_CONFIG() }), 'PROBE_BM_NET_ON')).toBe(true)
  })

  it('stays closed for an RTU-only master', () => {
    expect(defines(netSeam({ defines: ['BOARD_ESP32'], masterConfig: RTU_CONFIG() }), 'PROBE_BM_NET_ON')).toBe(false)
  })

  it('stays closed with the skeleton stub and no server', () => {
    expect(defines(netSeam({ defines: ['BOARD_ESP32'], masterConfig: STUB_CONFIG() }), 'PROBE_BM_NET_ON')).toBe(false)
  })

  it('still opens for the S7 server without a master', () => {
    const dump = netSeam({
      defines: ['BOARD_ESP32'],
      masterConfig: STUB_CONFIG(),
      configs: { 's7comm_config.h': S7_ON },
    })
    expect(defines(dump, 'PROBE_BM_NET_ON')).toBe(true)
  })
})

describeOnHost('baremetal_net.h on a NINA board (BOARD_WIFININA with MBTCP_WIFI)', () => {
  const NINA = ['BOARD_WIFININA', 'MBTCP_WIFI']

  it('takes WiFiNINA for the TCP master, not the generic Wi-Fi branch', () => {
    const dump = netSeam({ defines: NINA, masterConfig: TCP_CONFIG() })
    expect(wifiHeaders(dump)).toEqual({ wifiNina: true, wifi: false })
  })

  it('takes WiFiNINA for the S7 listener too', () => {
    const dump = netSeam({ defines: NINA, masterConfig: STUB_CONFIG(), configs: { 's7comm_config.h': S7_ON } })
    expect(wifiHeaders(dump)).toEqual({ wifiNina: true, wifi: false })
  })

  it('leaves the ESP32 on its own Wi-Fi branch', () => {
    const dump = netSeam({ defines: ['BOARD_ESP32', 'MBTCP_WIFI'], masterConfig: TCP_CONFIG() })
    expect(wifiHeaders(dump)).toEqual({ wifiNina: false, wifi: true })
  })
})

describeOnHost('Baremetal.ino with a TCP master and no Modbus or S7 server', () => {
  const code = (): string => sketch(TCP_CONFIG())

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

describeOnHost('Baremetal.ino with the skeleton stub', () => {
  const code = (): string => sketch(STUB_CONFIG())

  it.each(['setup', 'scheduler', 'loop'])('calls nothing of the master from %s()', (name) => {
    expect(functionBody(code(), name) ?? '').not.toMatch(/\bmb_master_\w*\s*\(/)
  })

  it('leaves the empty buffers unmapped without a Modbus or S7 server', () => {
    expect(callsOf(functionBody(code(), 'setup') ?? '', 'mapEmptyBuffers')).toEqual([])
  })

  it('still maps the empty buffers for the Modbus server', () => {
    const setup = functionBody(sketch(STUB_CONFIG(), ['MODBUS_ENABLED']), 'setup') ?? ''
    expect(callsOf(setup, 'mapEmptyBuffers').length).toBe(1)
  })
})
