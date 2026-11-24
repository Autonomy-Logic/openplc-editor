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

/** The lines of preprocessed `output` that come from `fileName` itself, by the preprocessor's line markers. */
function ownCode(output: string, fileName: string): string {
  const kept: string[] = []
  let current = ''
  for (const line of output.split('\n')) {
    const marker = /^# \d+ "([^"]*)"/.exec(line)
    if (marker !== null) {
      current = marker[1]
      continue
    }
    if (current === fileName || current.endsWith(`/${fileName}`)) kept.push(line)
  }
  return kept.join('\n')
}

const C_KEYWORDS = new Set(['if', 'while', 'for', 'switch', 'catch', 'return', 'sizeof', 'decltype', 'defined'])

/** Every function defined in `code`, by name (`Class::name` kept whole), with its body without the braces. */
function functionsOf(code: string): Array<{ name: string; body: string }> {
  const found: Array<{ name: string; body: string }> = []
  const head = /\b([A-Za-z_][\w:]*)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*(?:const\s*)?(?:->[^{;]*)?\{/g
  for (let match = head.exec(code); match !== null; match = head.exec(code)) {
    if (C_KEYWORDS.has(match[1])) continue
    let depth = 1
    let index = match.index + match[0].length
    const bodyStart = index
    while (index < code.length && depth > 0) {
      if (code[index] === '{') depth += 1
      if (code[index] === '}') depth -= 1
      index += 1
    }
    found.push({ name: match[1], body: code.slice(bodyStart, index - 1) })
    head.lastIndex = index
  }
  return found
}

/** `baremetal_net.cpp` preprocessed for `defines` with one TCP device, its own lines only. */
const netUnit = (defines: string[]): string =>
  ownCode(
    preprocess({ file: join(BAREMETAL_DIR, 'baremetal_net.cpp') }, { defines, masterConfig: TCP_CONFIG() }, false),
    'baremetal_net.cpp',
  )

/** A W5x00 shield on an AVR board: the SPI Ethernet branch and the library client. */
const W5X00 = ['MBTCP_ETHERNET']

/** A connection timeout set to zero, the form that makes Ethernet 2.0.2's `stop()` skip its graceful wait. */
const ZERO_TIMEOUT = /\bsetConnectionTimeout\s*\(\s*(?:\(\s*\w+\s*\)\s*)?0[uU]?[lL]?\s*\)/

describeOnHost('baremetal_net.cpp on a NINA board sends without waiting for the module (P07-1)', () => {
  const NINA = ['BOARD_WIFININA', 'MBTCP_WIFI']

  it('calls no checkDataSent(), the module query that polls with delay(100)', () => {
    expect(netUnit(NINA)).not.toMatch(/\bcheckDataSent\s*\(/)
  })

  it('calls no delay()', () => {
    expect(netUnit(NINA)).not.toMatch(/\bdelay\s*\(/)
  })

  it("never turns the library's send retry on", () => {
    expect(netUnit(NINA)).not.toMatch(/\bsetRetry\s*\(\s*true\s*\)/)
  })

  it("handles the sockets through the library's module driver", () => {
    expect(netUnit(NINA)).toMatch(/\bServerDrv\b/)
  })

  it('still takes WiFiNINA.h', () => {
    const dump = preprocess(
      { file: join(BAREMETAL_DIR, 'baremetal_net.cpp') },
      { defines: NINA, masterConfig: TCP_CONFIG() },
      true,
    )
    expect(wifiHeaders(dump)).toEqual({ wifiNina: true, wifi: false })
  })
})

describeOnHost('baremetal_net.cpp on a W5x00 board closes without waiting (P07-2)', () => {
  it('has a close form that does not wait: a zero connection timeout or an abort', () => {
    const code = netUnit(W5X00)
    expect(ZERO_TIMEOUT.test(code) || /\babort\s*\(/.test(code)).toBe(true)
  })

  it('never stops the master connection in Connection::close() with its connect timeout still set', () => {
    const close = functionsOf(netUnit(W5X00)).find((fn) => fn.name === 'Connection::close')
    if (close === undefined) throw new Error('Connection::close() is not defined for the W5x00 build')
    const stops = [...close.body.matchAll(/\.\s*stop\s*\(/g)].map((match) => match.index ?? 0)
    const zeroed = close.body.search(ZERO_TIMEOUT)
    expect(stops.filter((stop) => zeroed < 0 || zeroed > stop)).toEqual([])
  })
})

describeOnHost('modbus_master_tcp.cpp starts no connect in a pass that closed a connection (P07-2)', () => {
  const assignedIn = (body: string): string[] => {
    const names: string[] = []
    for (const match of body.matchAll(/(^|[;{}()\s])([A-Za-z_]\w*)\s*(?:=(?!=)|\+=|\|=|\+\+)/g)) {
      const before = body.slice(0, match.index + match[1].length)
      const statement = before.slice(
        Math.max(before.lastIndexOf(';'), before.lastIndexOf('{'), before.lastIndexOf('}')) + 1,
      )
      const prefix = statement.trim()
      if (prefix === '' || prefix.endsWith(')') || prefix === 'else') names.push(match[2])
    }
    return names
  }

  const unit = (): Array<{ name: string; body: string }> =>
    functionsOf(
      ownCode(
        preprocess(
          { file: join(BAREMETAL_DIR, 'modbus_master_tcp.cpp') },
          { defines: W5X00, masterConfig: TCP_CONFIG() },
          false,
        ),
        'modbus_master_tcp.cpp',
      ),
    )

  it('marks the pass on every close path, and the connect path reads that mark', () => {
    const functions = unit()
    const service = functions.find((fn) => fn.name === 'mb_master_tcp_service')
    if (service === undefined) throw new Error('mb_master_tcp_service() is not defined')
    const closePaths = functions.filter(
      (fn) => fn.name !== 'mb_master_tcp_start' && fn.name !== 'mb_master_tcp_stop' && /\.\s*close\s*\(/.test(fn.body),
    )
    const readByService = (name: string): boolean =>
      [...service.body.matchAll(new RegExp(`\\b${name}\\b(?!\\s*(?:=(?!=)|\\+=|\\|=|\\+\\+))`, 'g'))].length > 0

    expect(closePaths.length).toBeGreaterThan(0)
    expect(
      closePaths.filter((fn) => !assignedIn(fn.body).some((name) => readByService(name))).map((fn) => fn.name),
    ).toEqual([])
  })
})

/** An `opcua_config.h` with the server on and the debug log switched by `debugLog`. */
const opcuaConfig = (debugLog: 0 | 1): string =>
  `#ifndef OPCUA_CONFIG_H\n#define OPCUA_CONFIG_H\n#define OPCUA_ENABLED 1\n#define OPCUA_MAX_SESSIONS 2\n#define OPCUA_DEBUG_LOG ${debugLog}\n#endif\n`

/** The body of `class name` in preprocessed code, without its braces, or `null` when it is not declared. */
function classBody(code: string, name: string): string | null {
  const start = new RegExp(`\\bclass\\s+${name}\\b[^;{]*\\{`).exec(code)
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

/** Names of the member functions a class body declares, constructors and operators included. */
const declaredMembers = (body: string): string[] => [
  ...new Set([...body.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)].map((m) => m[1])),
]

/** Names of the members `code` calls on `object` with `object.name(`, in order of first call. */
const membersCalledOn = (code: string, object: string): string[] => [
  ...new Set([...code.matchAll(new RegExp(`\\b${object}\\s*\\.\\s*([A-Za-z_]\\w*)\\s*\\(`, 'g'))].map((m) => m[1])),
]

/** The argument text of every call of `name` in `code`, parentheses balanced. */
function callArguments(code: string, name: string): string[] {
  const found: string[] = []
  for (const match of code.matchAll(new RegExp(`\\b${name}\\s*\\(`, 'g'))) {
    let depth = 1
    let index = (match.index ?? 0) + match[0].length
    const start = index
    while (index < code.length && depth > 0) {
      if (code[index] === '(') depth += 1
      if (code[index] === ')') depth -= 1
      index += 1
    }
    found.push(code.slice(start, index - 1))
  }
  return found
}

describeOnHost('NINA OPC-UA debug log build (BOARD_WIFININA, MBTCP_WIFI, OPCUA_DEBUG_LOG 1)', () => {
  const NINA = ['BOARD_WIFININA', 'MBTCP_WIFI']

  const ninaOpcua = (file: string, debugLog: 0 | 1): string =>
    preprocess(
      { file: join(BAREMETAL_DIR, file) },
      { defines: NINA, masterConfig: STUB_CONFIG(), configs: { 'opcua_config.h': opcuaConfig(debugLog) } },
      false,
    )

  const members = (code: string, name: string): string[] => {
    const body = classBody(code, name)
    if (body === null) throw new Error(`class ${name} is not declared in the NINA build`)
    return declaredMembers(body)
  }

  it('declares available() on NinaServer', () => {
    expect(members(ninaOpcua('opcua_log.cpp', 1), 'NinaServer')).toContain('available')
  })

  it('declares port() on NinaClient', () => {
    expect(members(ninaOpcua('opcua_log.cpp', 1), 'NinaClient')).toContain('port')
  })

  it('declares on NinaServer every member opcua_log.cpp calls on the log server', () => {
    const code = ninaOpcua('opcua_log.cpp', 1)
    const called = membersCalledOn(ownCode(code, 'opcua_log.cpp'), 'g_log_server')
    const declared = members(code, 'NinaServer')

    expect(called.length).toBeGreaterThan(0)
    expect(called.filter((name) => !declared.includes(name))).toEqual([])
  })

  it('declares on NinaClient every member opcua_log.cpp calls on the log client', () => {
    const code = ninaOpcua('opcua_log.cpp', 1)
    const own = ownCode(code, 'opcua_log.cpp')
    const called = [...new Set([...membersCalledOn(own, 'g_log_client'), ...membersCalledOn(own, 'incoming')])]
    const declared = members(code, 'NinaClient')

    expect(called.length).toBeGreaterThan(0)
    expect(called.filter((name) => !declared.includes(name))).toEqual([])
  })

  it("declares on NinaClient the member baremetal_net.cpp's accept log calls on the accepted client", () => {
    const code = ninaOpcua('baremetal_net.cpp', 1)
    const logged = callArguments(ownCode(code, 'baremetal_net.cpp'), 'opcua_logf').flatMap((args) =>
      membersCalledOn(args, 'incoming'),
    )
    const declared = members(code, 'NinaClient')

    expect(logged.length).toBeGreaterThan(0)
    expect(logged.filter((name) => !declared.includes(name))).toEqual([])
  })

  it('compiles the log unit out with OPCUA_DEBUG_LOG 0', () => {
    expect(ownCode(ninaOpcua('opcua_log.cpp', 0), 'opcua_log.cpp')).not.toMatch(/\bg_log_server\b/)
  })
})

/** The body of the function `name` defined in `code`, by its plain or `bm_net::` qualified name, or `null`. */
const definedBody = (code: string, name: string): string | null =>
  functionsOf(code).find((fn) => fn.name === name || fn.name.endsWith(`::${name}`))?.body ?? null

/** The body of `bm_net::link_up()` in `baremetal_net.cpp` built for `defines` with one TCP device. */
function linkUpBody(defines: string[]): string {
  const body = definedBody(netUnit(defines), 'link_up')
  if (body === null) throw new Error(`bm_net::link_up() is not defined for ${defines.join(', ')}`)
  return body
}

const LINK_UP_WIFI: Array<[string, string[]]> = [
  ['ESP32 Wi-Fi', ['BOARD_ESP32', 'MBTCP_WIFI']],
  ['ESP8266', ['BOARD_ESP8266', 'MBTCP_WIFI']],
  ['NINA', ['BOARD_WIFININA', 'MBTCP_WIFI']],
  ['generic MBTCP_WIFI', ['MBTCP_WIFI']],
]

const LINK_UP_ALWAYS: Array<[string, string[]]> = [
  ['ENC28J60', ['MBTCP_ETHERNET', 'MBTCP_ETH_ENC28J60']],
  ['MBETH_MBED_LWIP', ['MBTCP_ETHERNET', 'MBETH_MBED_LWIP']],
  ['BOARD_LOGO8', ['BOARD_LOGO8', 'MBTCP_ETHERNET']],
]

const LINK_UP_EVERY: Array<[string, string[]]> = [
  ...LINK_UP_WIFI,
  ['W5x00', W5X00],
  ['ESP32 MBTCP_ETHERNET', ['BOARD_ESP32', 'MBTCP_ETHERNET']],
  ...LINK_UP_ALWAYS,
]

describeOnHost('baremetal_net.cpp answers bm_net::link_up() per adapter branch (MT-7)', () => {
  it.each(LINK_UP_WIFI)('%s: compares the Wi-Fi status with WL_CONNECTED', (_family, defines) => {
    expect(linkUpBody(defines)).toMatch(/\bWL_CONNECTED\b/)
  })

  it('W5x00: reads linkStatus() and counts every answer but LinkOFF as up', () => {
    const body = linkUpBody(W5X00)
    expect({ linkStatus: /\blinkStatus\s*\(/.test(body), linkOff: /\bLinkOFF\b/.test(body) }).toEqual({
      linkStatus: true,
      linkOff: true,
    })
  })

  it('ESP32 MBTCP_ETHERNET: reads linkUp() and the local address', () => {
    const body = linkUpBody(['BOARD_ESP32', 'MBTCP_ETHERNET'])
    expect({ linkUp: /\blinkUp\s*\(/.test(body), localIP: /\blocalIP\s*\(/.test(body) }).toEqual({
      linkUp: true,
      localIP: true,
    })
  })

  it.each(LINK_UP_ALWAYS)('%s: returns true', (_family, defines) => {
    expect(linkUpBody(defines).trim()).toMatch(/^return\s+true\s*;$/)
  })

  it.each(LINK_UP_EVERY)('%s: never waits', (_family, defines) => {
    const body = linkUpBody(defines)
    expect({ delay: /\bdelay\s*\(/.test(body), loop: /\b(?:while|for)\b/.test(body) }).toEqual({
      delay: false,
      loop: false,
    })
  })
})

/** `modbus_tcp.cpp` preprocessed for `defines` with the skeleton stub, its own lines only. */
const tcpUnit = (defines: string[]): string =>
  ownCode(
    preprocess({ file: join(BAREMETAL_DIR, 'modbus_tcp.cpp') }, { defines, masterConfig: STUB_CONFIG() }, false),
    'modbus_tcp.cpp',
  )

const ESP32_WIFI_NET = ['BOARD_ESP32', 'MBTCP_WIFI', 'OPLC_NET_ENABLED']
const ESP8266_WIFI_NET = ['BOARD_ESP8266', 'MBTCP_WIFI', 'OPLC_NET_ENABLED']

describeOnHost('modbus_tcp.cpp turns modem sleep off on ESP32 Wi-Fi only (MT-6)', () => {
  it('calls setSleep(false) in mbconfig_ethernet_iface() after WiFi.begin() and before the join wait', () => {
    const body = definedBody(tcpUnit(ESP32_WIFI_NET), 'mbconfig_ethernet_iface')
    if (body === null) throw new Error('mbconfig_ethernet_iface() is not defined for an ESP32 Wi-Fi build')
    const begin = body.search(/\bbegin\s*\(/)
    const sleepOff = body.search(/\bsetSleep\s*\(\s*false\s*\)/)
    const joinWait = body.search(/\bwhile\b/)
    expect({ begin: begin >= 0, afterBegin: sleepOff > begin, beforeJoinWait: sleepOff < joinWait }).toEqual({
      begin: true,
      afterBegin: true,
      beforeJoinWait: true,
    })
  })

  it.each([
    ['ESP8266', ESP8266_WIFI_NET],
    ['NINA', ['BOARD_WIFININA', 'MBTCP_WIFI', 'OPLC_NET_ENABLED']],
    ['generic MBTCP_WIFI', ['MBTCP_WIFI', 'OPLC_NET_ENABLED']],
  ])('%s: calls no setSleep()', (_family, defines) => {
    expect(tcpUnit(defines)).not.toMatch(/\bsetSleep\s*\(/)
  })
})

/** The name of the first function `body` calls, keywords skipped. */
const firstCall = (body: string): string | undefined =>
  [...body.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)].map((match) => match[1]).find((name) => !C_KEYWORDS.has(name))

/** Baremetal.ino preprocessed for `defines` with the debugger on and the skeleton stub. */
const sketchFor = (defines: string[]): string =>
  preprocess(SKETCH, { defines: ['DEBUGGER_ENABLED', ...defines], masterConfig: STUB_CONFIG() }, false)

const SUPERVISED: Array<[string, string[]]> = [
  ['ESP32 Wi-Fi', ESP32_WIFI_NET],
  ['ESP8266 Wi-Fi', ESP8266_WIFI_NET],
]

const NOT_SUPERVISED: Array<[string, string[]]> = [
  ['ESP32 MBTCP_ETHERNET', ['BOARD_ESP32', 'MBTCP_ETHERNET', 'OPLC_NET_ENABLED']],
  ['NINA Wi-Fi', ['BOARD_WIFININA', 'MBTCP_WIFI', 'OPLC_NET_ENABLED']],
  ['ESP32 Wi-Fi without OPLC_NET_ENABLED', ['BOARD_ESP32', 'MBTCP_WIFI']],
]

/** The top-level arguments of the first call of `name` in `code`, or `null` when `code` does not call it. */
function argumentsOf(code: string, name: string): string[] | null {
  const text = callArguments(code, name)[0]
  if (text === undefined) return null
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '(' || text[index] === '[') depth += 1
    if (text[index] === ')' || text[index] === ']') depth -= 1
    if (text[index] === ',' && depth === 0) {
      parts.push(text.slice(start, index).trim())
      start = index + 1
    }
  }
  parts.push(text.slice(start).trim())
  return parts
}

/**
 * `expression` followed by what it reads, transitively: the value of every name `body` assigns and the body of every
 * function `unit` defines that it names.
 */
function readsOf(expression: string, body: string, unit: Array<{ name: string; body: string }>): string {
  let text = expression
  const seen = new Set<string>()
  for (let round = 0; round < 4; round += 1) {
    const names = [...new Set([...text.matchAll(/\b[A-Za-z_]\w*\b/g)].map((match) => match[0]))].filter(
      (name) => !seen.has(name) && !C_KEYWORDS.has(name),
    )
    for (const name of names) {
      seen.add(name)
      const values = [...body.matchAll(new RegExp(`\\b${name}\\s*=(?!=)([^;]*);`, 'g'))].map((match) => match[1])
      const defined = unit.find((fn) => fn.name === name)?.body
      for (const value of defined === undefined ? values : [...values, defined]) text += ` (${value})`
    }
  }
  return text
}

/** Every `if` of `body`: its condition and the offsets of its then-branch, braces or single statement. */
function ifBranches(body: string): Array<{ condition: string; start: number; end: number }> {
  const found: Array<{ condition: string; start: number; end: number }> = []
  for (const match of body.matchAll(/\bif\s*\(/g)) {
    let depth = 1
    let index = (match.index ?? 0) + match[0].length
    const conditionStart = index
    while (index < body.length && depth > 0) {
      if (body[index] === '(') depth += 1
      if (body[index] === ')') depth -= 1
      index += 1
    }
    const condition = body.slice(conditionStart, index - 1)
    while (index < body.length && /\s/.test(body[index])) index += 1
    const start = index
    if (body[index] === '{') {
      depth = 1
      index += 1
      while (index < body.length && depth > 0) {
        if (body[index] === '{') depth += 1
        if (body[index] === '}') depth -= 1
        index += 1
      }
    } else {
      index = body.indexOf(';', index) + 1
    }
    found.push({ condition, start, end: index })
  }
  return found
}

const STATION_EVENTS = [
  'ARDUINO_EVENT_WIFI_STA_START',
  'ARDUINO_EVENT_WIFI_STA_CONNECTED',
  'ARDUINO_EVENT_WIFI_STA_DISCONNECTED',
  'ARDUINO_EVENT_WIFI_STA_GOT_IP',
  'ARDUINO_EVENT_WIFI_STA_LOST_IP',
]

const ESP8266_STATION_HANDLERS = ['onStationModeConnected', 'onStationModeDisconnected', 'onStationModeGotIP']

/** What the `joining` argument of the rule reads on each supervised board: the association state of the station. */
const JOINING_READS: Array<[string, string[], RegExp]> = [
  ['ESP32 Wi-Fi', ESP32_WIFI_NET, /\bSTA\s*\.\s*connected\s*\(/],
  ['ESP8266 Wi-Fi', ESP8266_WIFI_NET, /\bSTATION_CONNECTING\b/],
]

describeOnHost('Wi-Fi supervision on ESP32 and ESP8266 reconnects only through wifi_reconnect_due() (CR12-1)', () => {
  const supervise = (defines: string[]): string => {
    const body = definedBody(tcpUnit(defines), 'mbconfig_wifi_supervise')
    if (body === null) throw new Error(`mbconfig_wifi_supervise() is not defined for ${defines.join(', ')}`)
    return body
  }

  const ifaceBody = (defines: string[]): string => {
    const body = definedBody(tcpUnit(defines), 'mbconfig_ethernet_iface')
    if (body === null) throw new Error(`mbconfig_ethernet_iface() is not defined for ${defines.join(', ')}`)
    return body
  }

  /** What each argument of the rule's call in mbconfig_wifi_supervise() reads, in the order of the signature. */
  const ruleArguments = (defines: string[]): string[] => {
    const unit = functionsOf(tcpUnit(defines))
    const body = supervise(defines)
    const args = argumentsOf(body, 'wifi_reconnect_due')
    if (args === null) throw new Error(`no wifi_reconnect_due() call in mbconfig_wifi_supervise() for ${defines}`)
    return args.map((arg) => readsOf(arg, body, unit))
  }

  it.each(SUPERVISED)('%s: mbconfig_wifi_supervise() makes one WiFi.status() query', (_family, defines) => {
    expect(callsOf(supervise(defines), 'status').length).toBe(1)
  })

  it.each(SUPERVISED)(
    '%s: mbconfig_wifi_supervise() calls wifi_reconnect_due() with has_address read from WL_CONNECTED',
    (_family, defines) => {
      expect(ruleArguments(defines)[0] ?? '').toMatch(/\bWL_CONNECTED\b/)
    },
  )

  it.each(JOINING_READS)(
    '%s: mbconfig_wifi_supervise() passes the association state as joining',
    (_family, defines, joining) => {
      expect(ruleArguments(defines)[1] ?? '').toMatch(joining)
    },
  )

  it.each(SUPERVISED)(
    '%s: mbconfig_wifi_supervise() calls reconnect() only in the branch wifi_reconnect_due() guards',
    (_family, defines) => {
      const body = supervise(defines)
      const unit = functionsOf(tcpUnit(defines))
      const guarded = ifBranches(body).filter((branch) => {
        const reads = readsOf(branch.condition, body, unit)
        return (
          /\bwifi_reconnect_due\s*\(/.test(reads) &&
          !/^\s*!/.test(branch.condition) &&
          !/!\s*[(\s]*wifi_reconnect_due\b/.test(reads)
        )
      })
      const reconnects = callsOf(body, 'reconnect')
      expect({
        reconnects: reconnects.length > 0,
        unguarded: reconnects.filter((at) => !guarded.some((branch) => at >= branch.start && at < branch.end)),
      }).toEqual({ reconnects: true, unguarded: [] })
    },
  )

  it('removes the 10 s window WIFI_RECONNECT_AFTER_MS from modbus_tcp.cpp and modbus_tcp.h', () => {
    const naming = ['modbus_tcp.cpp', 'modbus_tcp.h'].filter((name) =>
      readFileSync(join(BAREMETAL_DIR, name), 'utf-8').includes('WIFI_RECONNECT_AFTER_MS'),
    )
    expect(naming).toEqual([])
  })

  it('ESP32 Wi-Fi: mbconfig_ethernet_iface() registers every WiFi.onEvent() before WiFi.begin()', () => {
    const body = ifaceBody(ESP32_WIFI_NET)
    const events = callsOf(body, 'onEvent')
    const begin = callsOf(body, 'begin')
    expect({
      registered: events.length > 0,
      beforeBegin: events.length > 0 && begin.length > 0 && Math.max(...events) < Math.min(...begin),
    }).toEqual({ registered: true, beforeBegin: true })
  })

  it('ESP32 Wi-Fi: modbus_tcp.cpp names every station event the supervision counts', () => {
    const code = tcpUnit(ESP32_WIFI_NET)
    expect(STATION_EVENTS.filter((id) => !new RegExp(`\\b${id}\\b`).test(code))).toEqual([])
  })

  it('ESP8266 Wi-Fi: mbconfig_ethernet_iface() registers every station handler before WiFi.begin()', () => {
    const body = ifaceBody(ESP8266_WIFI_NET)
    const begin = callsOf(body, 'begin')
    const late = ESP8266_STATION_HANDLERS.filter((handler) => {
      const calls = callsOf(body, handler)
      return calls.length === 0 || begin.length === 0 || Math.max(...calls) > Math.min(...begin)
    })
    expect(late).toEqual([])
  })

  it('ESP8266 Wi-Fi: keeps each station handler in a WiFiEventHandler that outlives mbconfig_ethernet_iface()', () => {
    const code = tcpUnit(ESP8266_WIFI_NET)
    const body = ifaceBody(ESP8266_WIFI_NET)
    const notKept = ESP8266_STATION_HANDLERS.filter((handler) => {
      const assignment = new RegExp(`\\b([A-Za-z_]\\w*)\\s*=\\s*(?:[A-Za-z_]\\w*\\s*\\.\\s*)?${handler}\\s*\\(`)
      const holder = assignment.exec(body)?.[1]
      if (holder === undefined) return true
      const declaredInFile = new RegExp(`\\bWiFiEventHandler\\s+${holder}\\b`).test(code)
      const declaredInBody = new RegExp(`\\b(?:WiFiEventHandler|auto)\\s+${holder}\\b`).test(body)
      return !declaredInFile || declaredInBody
    })
    expect(notKept).toEqual([])
  })

  it.each(SUPERVISED)(
    '%s: mbconfig_wifi_supervise() never waits, never begins again and prints nothing',
    (_family, defines) => {
      const body = supervise(defines)
      expect({
        delay: callsOf(body, 'delay').length > 0,
        begin: callsOf(body, 'begin').length > 0,
        loop: /\b(?:while|for)\b/.test(body),
        print: /\bprint(?:ln|f)?\s*\(/.test(body),
      }).toEqual({ delay: false, begin: false, loop: false, print: false })
    },
  )

  it.each(SUPERVISED)(
    '%s: loop() calls mbconfig_wifi_supervise() once, first, and nothing else calls it',
    (_family, defines) => {
      const code = sketchFor(defines)
      const loop = functionBody(code, 'loop') ?? ''
      expect({
        inLoop: callsOf(loop, 'mbconfig_wifi_supervise').length,
        first: firstCall(loop),
        inSketch: callsOf(ownCode(code, 'Baremetal.ino'), 'mbconfig_wifi_supervise').length,
      }).toEqual({ inLoop: 1, first: 'mbconfig_wifi_supervise', inSketch: 1 })
    },
  )

  it.each(NOT_SUPERVISED)('%s: mbconfig_wifi_supervise() is neither defined nor called', (_family, defines) => {
    expect({
      defined: definedBody(tcpUnit(defines), 'mbconfig_wifi_supervise') !== null,
      called: callsOf(ownCode(sketchFor(defines), 'Baremetal.ino'), 'mbconfig_wifi_supervise').length,
    }).toEqual({ defined: false, called: 0 })
  })
})
