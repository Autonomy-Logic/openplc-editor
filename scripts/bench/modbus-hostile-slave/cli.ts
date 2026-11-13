import { closeSync, openSync, writeSync } from 'node:fs'
import net from 'node:net'
import readline from 'node:readline'
import { Duplex } from 'node:stream'
import { parseArgs } from 'node:util'

import { loadRegisterMap, RegisterTables } from './registers'
import {
  debuggerReadFrame,
  Endpoint,
  rtuMasterReadFrame,
  serialClientRole,
  startAttacker,
  tcpClientRole,
} from './roles'
import {
  checkScenario,
  ClientRole,
  Clock,
  createScenario,
  DEFAULT_GROUPS,
  Groups,
  Log,
  LogEvent,
  RunningSlave,
  runSlave,
  ScenarioEngine,
  Transport,
} from './scenario'

const USAGE = `usage: npm run bench:hostile-slave -- --scenario <name> [--row <n>]
  (--tcp-listen <ip:port> | --serial <path> --baud <n> [--parity N|E|O] [--stop 1|2])
  [--board <ip[:port]>] [--log <file.jsonl>] [--map <file.json>] [--groups g1=<addr>,g2=<addr>,g3=<addr>]
  [--duration-scale <factor>] [--client-serial <path> --client-baud <n> [--client-parity N|E|O] [--client-stop 1|2]]
  [--client-unit <id>] [--debug-index <arr:elem>[,<arr:elem>...]]
See scripts/bench/modbus-hostile-slave/README.md.`

/** A serial line given on the command line. */
type SerialSettings = { path: string; baudRate: number; parity: 'none' | 'even' | 'odd'; stopBits: 1 | 2 }

/** The validated command line. */
type Config = {
  scenario: string
  row: number | undefined
  transport: Transport | null
  listen: Endpoint | null
  serial: SerialSettings | null
  board: Endpoint | null
  logFile: string | null
  map: RegisterTables | undefined
  groups: Groups
  durationScale: number
  clientSerial: SerialSettings | null
  clientUnit: number
  debugAddresses: Array<{ arr: number; elem: number }>
}

/** Scenarios whose only required role is the attacker; the slave role is optional for them. */
const ATTACKER_SCENARIOS = new Set(['AS-08', 'AS-13'])

/** Board port each scenario targets when `--board` gives none. */
const BOARD_PORTS: Readonly<Record<string, number>> = { 'AS-08': 102 }

/** Hold time of AS-13 before the connections are released, before `--duration-scale`. */
const RELEASE_AFTER_MS = 60_000

function fail(message: string): never {
  throw new Error(message)
}

function integer(name: string, text: string, min: number, max: number): number {
  const value = Number(text)
  if (!/^\d+$/.test(text) || value < min || value > max) {
    fail(`--${name} must be an integer from ${min} to ${max}, got "${text}"`)
  }
  return value
}

function address(name: string, text: string): string {
  if (net.isIP(text) === 0) {
    fail(`--${name} needs an IP address, got "${text}"`)
  }
  return text
}

function endpoint(name: string, text: string, defaultPort: number | null): Endpoint {
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(text)
  const separator = text.lastIndexOf(':')
  const plain = net.isIP(text) !== 0
  const host = bracketed ? bracketed[1] : plain ? text : separator > 0 ? text.slice(0, separator) : text
  const portText = bracketed ? bracketed[2] : plain ? undefined : separator > 0 ? text.slice(separator + 1) : undefined
  if (portText === undefined && defaultPort === null) {
    fail(`--${name} needs <ip:port>, got "${text}"`)
  }
  return {
    host: address(name, host),
    port: portText === undefined ? (defaultPort ?? 0) : integer(name, portText, 0, 65535),
  }
}

function parity(name: string, text: string | undefined): SerialSettings['parity'] {
  switch ((text ?? 'N').toUpperCase()) {
    case 'N':
      return 'none'
    case 'E':
      return 'even'
    case 'O':
      return 'odd'
    default:
      return fail(`--${name} must be N, E or O, got "${text}"`)
  }
}

function stopBits(name: string, text: string | undefined): 1 | 2 {
  if (text === undefined || text === '1') {
    return 1
  }
  return text === '2' ? 2 : fail(`--${name} must be 1 or 2, got "${text}"`)
}

function serialSettings(prefix: '' | 'client-', values: Record<string, string | undefined>): SerialSettings | null {
  const path = values[`${prefix}serial`]
  if (path === undefined) {
    return null
  }
  const baud = values[`${prefix}baud`]
  if (baud === undefined) {
    fail(`--${prefix}serial needs --${prefix}baud`)
  }
  return {
    path,
    baudRate: integer(`${prefix}baud`, baud, 1, 4_000_000),
    parity: parity(`${prefix}parity`, values[`${prefix}parity`]),
    stopBits: stopBits(`${prefix}stop`, values[`${prefix}stop`]),
  }
}

function groups(text: string | undefined): Groups {
  const parsed: Groups = { ...DEFAULT_GROUPS }
  if (text === undefined) {
    return parsed
  }
  for (const part of text.split(',')) {
    const [name, value] = part.split('=')
    if (name !== 'g1' && name !== 'g2' && name !== 'g3') {
      fail(`--groups takes g1=<addr>,g2=<addr>,g3=<addr>, got "${part}"`)
    }
    parsed[name] = integer('groups', value ?? '', 0, 65535)
  }
  return parsed
}

function debugAddresses(text: string | undefined): Array<{ arr: number; elem: number }> {
  if (text === undefined) {
    return []
  }
  return text.split(',').map((part) => {
    const [arr, elem] = part.split(':')
    return { arr: integer('debug-index', arr ?? '', 0, 255), elem: integer('debug-index', elem ?? '', 0, 65535) }
  })
}

/** Parses and checks the command line; throws an error with the reason when it is not usable. */
function parseConfig(argv: readonly string[]): Config {
  const { values } = parseArgs({
    args: [...argv],
    strict: true,
    allowPositionals: false,
    options: {
      scenario: { type: 'string' },
      row: { type: 'string' },
      'tcp-listen': { type: 'string' },
      serial: { type: 'string' },
      baud: { type: 'string' },
      parity: { type: 'string' },
      stop: { type: 'string' },
      board: { type: 'string' },
      log: { type: 'string' },
      map: { type: 'string' },
      groups: { type: 'string' },
      'duration-scale': { type: 'string' },
      'client-serial': { type: 'string' },
      'client-baud': { type: 'string' },
      'client-parity': { type: 'string' },
      'client-stop': { type: 'string' },
      'client-unit': { type: 'string' },
      'debug-index': { type: 'string' },
    },
  })
  const scenario = values.scenario ?? fail('--scenario is required')
  const row = values.row === undefined ? undefined : integer('row', values.row, 1, 99)
  const listen = values['tcp-listen'] === undefined ? null : endpoint('tcp-listen', values['tcp-listen'], null)
  if (listen && (listen.host === '0.0.0.0' || listen.host === '::')) {
    fail('--tcp-listen needs the address of one interface, not the wildcard address')
  }
  const serial = serialSettings('', values)
  if (listen && serial) {
    fail('give either --tcp-listen or --serial, not both')
  }
  const transport: Transport | null = listen ? 'tcp' : serial ? 'rtu' : null
  if (transport === null && !ATTACKER_SCENARIOS.has(scenario)) {
    checkScenario(scenario, row, 'tcp')
    fail(`scenario "${scenario}" needs --tcp-listen or --serial`)
  }
  const spec = checkScenario(scenario, row, transport ?? 'tcp')
  const board = values.board === undefined ? null : endpoint('board', values.board, BOARD_PORTS[scenario] ?? 502)
  const durationText = values['duration-scale'] ?? '1'
  const durationScale = Number(durationText)
  if (!Number.isFinite(durationScale) || durationScale <= 0) {
    fail(`--duration-scale must be a positive number, got "${durationText}"`)
  }
  const config: Config = {
    scenario,
    row,
    transport,
    listen,
    serial,
    board,
    logFile: values.log ?? null,
    map: values.map === undefined ? undefined : loadRegisterMap(values.map),
    groups: groups(values.groups),
    durationScale,
    clientSerial: serialSettings('client-', values),
    clientUnit: values['client-unit'] === undefined ? 1 : integer('client-unit', values['client-unit'], 1, 247),
    debugAddresses: debugAddresses(values['debug-index']),
  }
  if (ATTACKER_SCENARIOS.has(scenario) && !board) {
    fail(`scenario "${scenario}" needs --board`)
  }
  if (spec.needsClient && row === 1 && !board) {
    fail(`scenario "${scenario}" row 1 needs --board`)
  }
  if (spec.needsClient && row !== 1 && !config.clientSerial) {
    fail(`scenario "${scenario}" row ${row} needs --client-serial and --client-baud`)
  }
  if (spec.needsClient && row === 2 && config.debugAddresses.length === 0) {
    fail(`scenario "${scenario}" row 2 needs --debug-index`)
  }
  return config
}

/** The process clock: microseconds since start from the monotonic high-resolution timer. */
function realClock(): Clock & { cancelAll: () => void } {
  const start = process.hrtime.bigint()
  const timers = new Map<number, NodeJS.Timeout>()
  let next = 1
  return {
    nowUs: () => Number((process.hrtime.bigint() - start) / 1000n),
    setTimeout: (callback, ms) => {
      const id = next
      next += 1
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id)
          callback()
        }, ms),
      )
      return id
    },
    clearTimeout: (handle) => {
      const timer = typeof handle === 'number' ? timers.get(handle) : undefined
      if (timer !== undefined && typeof handle === 'number') {
        clearTimeout(timer)
        timers.delete(handle)
      }
    },
    cancelAll: () => {
      timers.forEach((timer) => clearTimeout(timer))
      timers.clear()
    },
  }
}

/** The script log: one JSON line per event, to the `--log` file or, without one, to stdout. */
function openLog(file: string | null, clock: Clock): { log: Log; close: () => void } {
  const fd = file === null ? null : openSync(file, 'w')
  const log: Log = (event) => {
    const { t_us: stamp, ...rest } = event
    const line = `${JSON.stringify({ t_us: typeof stamp === 'number' ? stamp : clock.nowUs(), ...rest })}\n`
    if (fd === null) {
      process.stdout.write(line)
    } else {
      writeSync(fd, line)
    }
  }
  return { log, close: () => (fd === null ? undefined : closeSync(fd)) }
}

function tagged(log: Log, tags: LogEvent): Log {
  return (event) => log({ ...tags, ...event })
}

async function openSerial(settings: SerialSettings, log: Log): Promise<Duplex> {
  const { SerialPort } = await import('serialport')
  const port = new SerialPort({ ...settings, dataBits: 8, autoOpen: false })
  await new Promise<void>((resolve, reject) => port.open((error) => (error ? reject(error) : resolve())))
  log({
    event: 'opened',
    path: settings.path,
    baud: settings.baudRate,
    parity: settings.parity,
    stop: settings.stopBits,
  })
  port.on('error', (error: Error) => log({ event: 'error', path: settings.path, message: error.message }))
  return port
}

function rtuFloodBlock(settings: SerialSettings): number {
  const bitsPerChar = 1 + 8 + (settings.parity === 'none' ? 0 : 1) + settings.stopBits
  return Math.max(1, Math.ceil(((settings.baudRate / bitsPerChar) * 2) / 1000))
}

function waitForAccept(): Promise<void> {
  return new Promise((resolve) => {
    const input = readline.createInterface({ input: process.stdin })
    input.on('line', (line) => {
      if (line.trim() === 'accept') {
        input.close()
        resolve()
      }
    })
  })
}

async function main(argv: readonly string[]): Promise<void> {
  let config: Config
  try {
    config = parseConfig(argv)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${USAGE}\n`)
    process.exit(2)
  }

  const clock = realClock()
  const sink = openLog(config.logFile, clock)
  const closers: Array<() => void> = []
  let shuttingDown = false
  const shutdown = (code: number): void => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true
    closers.reverse().forEach((close) => close())
    clock.cancelAll()
    sink.log({ event: 'stopped', code })
    sink.close()
    process.exit(code)
  }
  process.on('SIGTERM', () => shutdown(0))
  process.on('SIGINT', () => shutdown(0))
  process.on('beforeExit', () => shutdown(0))

  try {
    sink.log({
      event: 'start',
      scenario: config.scenario,
      row: config.row,
      transport: config.transport,
      duration_scale: config.durationScale,
      groups: config.groups,
    })
    const client = await startClient(config, clock, tagged(sink.log, { role: 'client' }), closers)
    if (config.transport !== null) {
      const engine = createScenario({
        scenario: config.scenario,
        row: config.row,
        transport: config.transport,
        log: tagged(sink.log, { role: 'slave' }),
        clock,
        groups: config.groups,
        map: config.map,
        durationScale: config.durationScale,
        client,
      })
      closers.push(engine.stop)
      if (config.listen) {
        await startTcpSlave(config, config.listen, engine, clock, sink.log, closers)
      } else if (config.serial) {
        await startRtuSlave(config, config.serial, engine, clock, sink.log, closers)
      }
    }
    if (ATTACKER_SCENARIOS.has(config.scenario) && config.board) {
      const attacker = startAttacker({
        target: config.board,
        mode: config.scenario === 'AS-08' ? 'hold' : 'saturate',
        releaseAfterMs: RELEASE_AFTER_MS * config.durationScale,
        clock,
        log: tagged(sink.log, { role: 'attacker' }),
      })
      closers.push(attacker.stop)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    sink.log({ event: 'error', message })
    process.stderr.write(`${message}\n`)
    shutdown(1)
  }
}

async function startClient(
  config: Config,
  clock: Clock,
  log: Log,
  closers: Array<() => void>,
): Promise<ClientRole | undefined> {
  if (config.scenario !== 'AS-04') {
    return undefined
  }
  if (config.row === 1 && config.board) {
    const role = tcpClientRole(config.board, log)
    closers.push(role.close)
    return role
  }
  if (!config.clientSerial) {
    return undefined
  }
  const stream = await openSerial(config.clientSerial, log)
  closers.push(() => stream.destroy())
  return config.row === 2
    ? serialClientRole(
        stream,
        debuggerReadFrame(config.debugAddresses),
        { kind: 'debugger', fc: 0x44, addresses: config.debugAddresses.map(({ arr, elem }) => `${arr}:${elem}`) },
        log,
      )
    : serialClientRole(
        stream,
        rtuMasterReadFrame(config.clientUnit),
        { kind: 'rtu-master', unit: config.clientUnit, fc: 3, address: 0, quantity: 10 },
        log,
      )
}

async function startTcpSlave(
  config: Config,
  listen: Endpoint,
  engine: ScenarioEngine,
  clock: Clock,
  log: Log,
  closers: Array<() => void>,
): Promise<void> {
  if (config.scenario === 'AS-09') {
    log({ event: 'phase', phase: config.row === 2 ? 'drop' : 'reset', host: listen.host, port: listen.port })
    await waitForAccept()
    log({ event: 'phase', phase: 'accept' })
  }
  const slaves = new Set<{ socket: net.Socket; slave: RunningSlave }>()
  const server = net.createServer((socket) => {
    const tags = { role: 'slave', peerAddress: socket.remoteAddress, peerPort: socket.remotePort }
    log({ event: 'accepted', ...tags })
    const slave = runSlave({
      scenario: config.scenario,
      row: config.row,
      transport: 'tcp',
      stream: socket,
      log,
      clock,
      engine,
      tags,
    })
    const entry = { socket, slave }
    slaves.add(entry)
    socket.on('error', (error: NodeJS.ErrnoException) => log({ event: 'error', ...tags, code: error.code }))
    socket.on('close', () => {
      slaves.delete(entry)
      slave.stop()
      log({ event: 'closed', ...tags })
    })
  })
  closers.push(() => {
    server.close()
    slaves.forEach(({ socket, slave }) => {
      slave.stop()
      socket.destroy()
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: listen.host, port: listen.port, exclusive: true }, () => {
      server.off('error', reject)
      const bound = server.address()
      log({
        event: 'listening',
        role: 'slave',
        host: listen.host,
        port: typeof bound === 'object' && bound ? bound.port : listen.port,
      })
      resolve()
    })
  })
}

async function startRtuSlave(
  config: Config,
  serial: SerialSettings,
  engine: ScenarioEngine,
  clock: Clock,
  log: Log,
  closers: Array<() => void>,
): Promise<void> {
  const tags = { role: 'slave', path: serial.path }
  const stream = await openSerial(serial, tagged(log, tags))
  const slave = runSlave({
    scenario: config.scenario,
    row: config.row,
    transport: 'rtu',
    stream,
    log,
    clock,
    engine,
    tags,
    floodBlock: rtuFloodBlock(serial),
  })
  closers.push(() => {
    slave.stop()
    stream.destroy()
  })
}

void main(process.argv.slice(2))
