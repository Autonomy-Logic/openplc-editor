import { Duplex } from 'node:stream'

import {
  answerFrame,
  FC,
  range,
  registersAnswerPdu,
  Request,
  rtuAdu,
  SLAVE_UNIT,
  takeRtuRequests,
  takeTcpRequests,
  tcpAdu,
  words,
} from './frames'
import { answerFromTables, emptyRegisterMap, RegisterTables } from './registers'

/** Time source and timers of a scenario. */
export type Clock = {
  nowUs: () => number
  setTimeout: (callback: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}

/** One event of the script log. */
export type LogEvent = Record<string, unknown>

/** Receives every event of the script log. */
export type Log = (event: LogEvent) => void

/** The slave's wire: Modbus TCP over a socket or Modbus RTU over a serial line. */
export type Transport = 'tcp' | 'rtu'

/** Starting addresses of the FC 3 reads that make up the poll groups G1, G2 and G3. */
export type Groups = { g1: number; g2: number; g3: number }

/** The default poll groups: G1 at holding register 0, G2 at 10 and G3 at 20. */
export const DEFAULT_GROUPS: Groups = { g1: 0, g2: 10, g3: 20 }

/** The `client` role of AS-04: sends one read of the board's %QW0..%QW9 per call. */
export type ClientRole = { request: () => void }

/** What a scenario accepts: its transports, its rows and whether it needs the client role. */
export type ScenarioSpec = { transports: readonly Transport[]; rows: readonly number[]; needsClient: boolean }

const BOTH: readonly Transport[] = ['tcp', 'rtu']

/** Every scenario the tool plays. */
export const SCENARIOS: Readonly<Record<string, ScenarioSpec>> = {
  normal: { transports: BOTH, rows: [], needsClient: false },
  'AS-01': { transports: ['tcp'], rows: [], needsClient: false },
  'AS-02': { transports: ['tcp'], rows: range(1, 9), needsClient: false },
  'AS-03': { transports: ['tcp'], rows: [], needsClient: false },
  'AS-04': { transports: BOTH, rows: range(1, 3), needsClient: true },
  'AS-06': { transports: BOTH, rows: [], needsClient: false },
  'AS-07': { transports: BOTH, rows: [], needsClient: false },
  'AS-08': { transports: BOTH, rows: [], needsClient: false },
  'AS-09': { transports: ['tcp'], rows: [1, 2], needsClient: false },
  'AS-10': { transports: ['tcp'], rows: [], needsClient: false },
  'AS-11': { transports: ['rtu'], rows: [1, 2], needsClient: false },
  'AS-12': { transports: ['rtu'], rows: [], needsClient: false },
  'AS-13': { transports: BOTH, rows: [], needsClient: false },
}

/** Throws an error naming the scenario when it is unknown or does not accept this row or transport. */
export function checkScenario(scenario: string, row: number | undefined, transport: Transport): ScenarioSpec {
  const spec = Object.prototype.hasOwnProperty.call(SCENARIOS, scenario) ? SCENARIOS[scenario] : undefined
  if (!spec) {
    throw new Error(`unknown scenario "${scenario}"; known scenarios: ${Object.keys(SCENARIOS).join(', ')}`)
  }
  if (!spec.transports.includes(transport)) {
    throw new Error(`scenario "${scenario}" does not run over ${transport.toUpperCase()}`)
  }
  if (spec.rows.length === 0 && row !== undefined) {
    throw new Error(`scenario "${scenario}" has no rows`)
  }
  if (spec.rows.length > 0 && (row === undefined || !spec.rows.includes(row))) {
    throw new Error(`scenario "${scenario}" needs --row ${spec.rows[0]}..${spec.rows[spec.rows.length - 1]}`)
  }
  return spec
}

/** Byte interval of AS-06. */
export const TRICKLE_INTERVAL_MS = 400
/** Length of the AS-06 trickle window, before `durationScale`. */
export const TRICKLE_WINDOW_MS = 5 * 60_000
/** Length of the AS-07 flood, before `durationScale`. */
export const FLOOD_MS = 60_000
/** Length of the AS-10 read stop, before `durationScale`. */
export const READ_STOP_MS = 15 * 60_000
/** Answer delay of AS-04. */
export const DELAYED_ANSWER_MS = 200
/** Number of AS-04 polls that trigger a client read. */
export const CLIENT_READS = 50
/** Bytes written per flood tick when the caller does not size the flood. */
export const DEFAULT_FLOOD_BLOCK = 512

const BASELINE_G1 = range(101, 110)
const BASELINE_G2 = [23130]
const RECOVERY_G1 = range(501, 510)
const LATE_G1 = range(1111, 1120)
const LATE_G2 = [3333, 4444]
const RESUME_VALUES = [4321, 8765]
const G3_VALUE = [23130]

/** First register value carried by the malformed answers, which count up from it. */
const HOSTILE_FIRST = 201

function hostileWords(count: number): Buffer {
  return words(range(HOSTILE_FIRST, HOSTILE_FIRST + count - 1))
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex')
}

/** One open TCP connection or serial line of the slave, with paced output on top of the raw stream. */
export class SlaveLink {
  closed = false
  private queue: Array<{ bytes: Buffer; intervalMs: number }> = []
  private sending = false
  private flooding = false
  private floodTimer: unknown = null
  private readonly timers = new Set<unknown>()

  constructor(
    readonly transport: Transport,
    private readonly stream: Duplex,
    private readonly clock: Clock,
    private readonly log: Log,
    private readonly floodBlock: number,
  ) {}

  /** Runs `callback` after `ms` on the scenario clock, unless the link closed meanwhile. */
  later(ms: number, callback: () => void): unknown {
    const handle = this.clock.setTimeout(() => {
      this.timers.delete(handle)
      if (!this.closed) {
        callback()
      }
    }, ms)
    this.timers.add(handle)
    return handle
  }

  private cancel(handle: unknown): void {
    this.clock.clearTimeout(handle)
    this.timers.delete(handle)
  }

  private write(bytes: Buffer): void {
    if (this.closed || this.stream.destroyed || bytes.length === 0) {
      return
    }
    this.log({ event: 'tx', hex: hex(bytes) })
    this.stream.write(bytes)
  }

  /** Queues `bytes` to be written at once, after any output already queued. */
  send(bytes: Buffer): void {
    this.queue.push({ bytes, intervalMs: 0 })
    this.pump()
  }

  /** Queues `bytes` to be written one byte every `intervalMs`, after any output already queued. */
  trickle(bytes: Buffer, intervalMs: number): void {
    this.queue.push({ bytes, intervalMs })
    this.pump()
  }

  private pump(): void {
    while (!this.sending && !this.flooding && !this.closed) {
      const item = this.queue.shift()
      if (!item) {
        return
      }
      if (item.intervalMs <= 0) {
        this.write(item.bytes)
        continue
      }
      this.sending = true
      let index = 0
      const step = (): void => {
        this.write(item.bytes.subarray(index, index + 1))
        index += 1
        this.later(item.intervalMs, () => {
          if (index < item.bytes.length) {
            step()
          } else {
            this.sending = false
            this.pump()
          }
        })
      }
      step()
    }
  }

  /** Writes 0xFF blocks back to back, one per clock tick, holding queued output until `stopFlood`. */
  startFlood(): void {
    if (this.flooding) {
      return
    }
    this.flooding = true
    this.floodTick()
  }

  private readonly floodTick = (): void => {
    this.floodTimer = null
    if (!this.flooding || this.closed) {
      return
    }
    if (this.stream.writableNeedDrain) {
      this.stream.once('drain', this.floodTick)
      return
    }
    this.write(Buffer.alloc(this.floodBlock, 0xff))
    this.floodTimer = this.later(0, this.floodTick)
  }

  /** Stops the flood and releases the queued output. */
  stopFlood(): void {
    this.flooding = false
    if (this.floodTimer !== null) {
      this.cancel(this.floodTimer)
      this.floodTimer = null
    }
    this.stream.off('drain', this.floodTick)
    this.pump()
  }

  /** Stops reading the stream, so the peer's bytes stay in the receive buffers. */
  pauseReading(): void {
    this.stream.pause()
  }

  /** Reads the stream again. */
  resumeReading(): void {
    if (!this.closed) {
      this.stream.resume()
    }
  }

  /** Drops the queued output and cancels every timer of the link. */
  close(): void {
    this.closed = true
    this.flooding = false
    this.queue = []
    this.stream.off('drain', this.floodTick)
    for (const handle of this.timers) {
      this.clock.clearTimeout(handle)
    }
    this.timers.clear()
  }
}

/** Options shared by a scenario engine and `runSlave`. */
export type ScenarioOptions = {
  scenario: string
  row?: number
  transport: Transport
  log: Log
  clock: Clock
  groups?: Groups
  map?: RegisterTables
  durationScale?: number
  client?: ClientRole
}

/** The behaviour of one scenario, shared by every connection of a run. */
export type ScenarioEngine = {
  attach: (link: SlaveLink) => void
  handle: (request: Request, link: SlaveLink) => void
  detach: (link: SlaveLink) => void
  stop: () => void
}

type Handler = {
  handle: (request: Request, link: SlaveLink) => void
  attach?: (link: SlaveLink) => void
  detach?: (link: SlaveLink) => void
}

type GroupName = 'g1' | 'g2' | 'g3'

type Context = {
  transport: Transport
  groups: Groups
  tables: RegisterTables
  scale: number
  client: ClientRole | undefined
  row: number | undefined
  phase: (name: string, fields?: LogEvent) => void
  later: (ms: number, callback: () => void) => void
  log: Log
}

function groupOf(groups: Groups, request: Request): GroupName | null {
  if (request.fc !== FC.readHoldingRegisters) {
    return null
  }
  if (request.address === groups.g1) {
    return 'g1'
  }
  if (request.address === groups.g2) {
    return 'g2'
  }
  return request.address === groups.g3 ? 'g3' : null
}

/** A frame of the script: unit id 1, protocol id 0 and the request's transaction id. */
function scripted(link: SlaveLink, request: Request, pdu: Uint8Array): Buffer {
  return link.transport === 'tcp' ? tcpAdu({ tid: request.tid ?? 0, unit: SLAVE_UNIT }, pdu) : rtuAdu(SLAVE_UNIT, pdu)
}

function answerValues(link: SlaveLink, request: Request, values: readonly number[]): void {
  link.send(scripted(link, request, registersAnswerPdu(values)))
}

function answerNormally(ctx: Context, link: SlaveLink, request: Request): void {
  link.send(answerFrame(link.transport, request, answerFromTables(ctx.tables, request.pdu)))
}

function normalScenario(ctx: Context): Handler {
  return { handle: (request, link) => answerNormally(ctx, link, request) }
}

function as01Hostile(request: Request): Buffer {
  const pdu = Buffer.alloc(999)
  pdu[0] = FC.readHoldingRegisters
  pdu[1] = 20
  hostileWords(10).copy(pdu, 2)
  return tcpAdu({ tid: request.tid ?? 0, unit: SLAVE_UNIT, length: 0xffff }, pdu)
}

function as02Hostile(row: number, request: Request): Buffer {
  const tid = request.tid ?? 0
  const fields = { tid, unit: SLAVE_UNIT }
  const validG1 = registersAnswerPdu(range(HOSTILE_FIRST, HOSTILE_FIRST + 9))
  const short = Buffer.concat([Buffer.from([FC.readHoldingRegisters, 20]), hostileWords(3)])
  switch (row) {
    case 1:
      return tcpAdu(fields, Buffer.concat([Buffer.from([FC.readHoldingRegisters, 40]), hostileWords(20)]))
    case 2:
      return tcpAdu(fields, Buffer.concat([Buffer.from([FC.readHoldingRegisters, 10]), hostileWords(5)]))
    case 3:
      return tcpAdu({ ...fields, length: 9 }, short)
    case 4:
      return tcpAdu({ ...fields, length: 23 }, short)
    case 5:
      return tcpAdu(fields, Buffer.from([FC.readHoldingRegisters | 0x80, 0x02]))
    case 6:
      return tcpAdu({ ...fields, tid: (tid + 1) & 0xffff }, validG1)
    case 7:
      return tcpAdu({ ...fields, protocol: 1 }, validG1)
    case 8:
      return tcpAdu({ ...fields, unit: 2 }, validG1)
    default:
      return tcpAdu(fields, registersAnswerPdu(range(HOSTILE_FIRST, HOSTILE_FIRST + 9), FC.readInputRegisters))
  }
}

/** AS-01 and AS-02: baseline answers to G1 and G2, one malformed answer to G1, then 501..510 on G1. */
function baselineThenHostile(ctx: Context, hostile: (request: Request) => Buffer): Handler {
  let g1Answered = false
  let g2Answered = false
  let hostileSent = false
  let recovered = false
  return {
    handle: (request, link) => {
      switch (groupOf(ctx.groups, request)) {
        case 'g1':
          if (hostileSent) {
            if (!recovered) {
              recovered = true
              ctx.phase('recovery')
            }
            answerValues(link, request, RECOVERY_G1)
          } else if (g1Answered && g2Answered) {
            hostileSent = true
            ctx.phase('hostile')
            link.send(hostile(request))
          } else {
            g1Answered = true
            answerValues(link, request, BASELINE_G1)
          }
          return
        case 'g2':
          g2Answered = true
          answerValues(link, request, BASELINE_G2)
          return
        default:
          answerNormally(ctx, link, request)
      }
    },
  }
}

/** AS-03 and AS-12: G1 left unanswered, its late answer sent on G2's request. */
function lateResponse(ctx: Context): Handler {
  const heldG1 = new Map<SlaveLink, Request>()
  let lateSent = false
  return {
    detach: (link) => {
      heldG1.delete(link)
    },
    handle: (request, link) => {
      switch (groupOf(ctx.groups, request)) {
        case 'g3':
          answerValues(link, request, G3_VALUE)
          return
        case 'g1':
          if (lateSent) {
            answerValues(link, request, LATE_G1)
          } else {
            heldG1.set(link, request)
            ctx.log({ event: 'withheld', tid: request.tid, group: 'g1' })
          }
          return
        case 'g2': {
          const held = heldG1.get(link)
          if (!lateSent && held) {
            lateSent = true
            heldG1.delete(link)
            ctx.phase('late-response', { tid: held.tid })
            answerValues(link, held, LATE_G1)
            if (link.transport === 'tcp') {
              answerValues(link, request, LATE_G2)
            }
          } else {
            answerValues(link, request, LATE_G2)
          }
          return
        }
        default:
          answerNormally(ctx, link, request)
      }
    },
  }
}

/** AS-04: G1 answered 200 ms late with a counter, a client read of the board sent before each of the first 50. */
function delayedWithClient(ctx: Context): Handler {
  const client = ctx.client
  if (!client) {
    throw new Error('scenario "AS-04" needs the client role')
  }
  let polls = 0
  return {
    handle: (request, link) => {
      if (groupOf(ctx.groups, request) !== 'g1') {
        answerNormally(ctx, link, request)
        return
      }
      polls += 1
      const counter = polls & 0xffff
      ctx.log({ event: 'poll', poll: polls, counter })
      if (polls <= CLIENT_READS) {
        client.request()
        if (polls === CLIENT_READS) {
          ctx.phase('client-reads-done', { reads: CLIENT_READS })
        }
      }
      link.later(DELAYED_ANSWER_MS, () => answerValues(link, request, new Array<number>(10).fill(counter)))
    },
  }
}

/** AS-06: every answer sent one byte every 400 ms, for 5 minutes from the first request. */
function trickle(ctx: Context, nowUs: () => number): Handler {
  let windowEndUs: number | null = null
  return {
    handle: (request, link) => {
      if (windowEndUs === null) {
        windowEndUs = nowUs() + TRICKLE_WINDOW_MS * ctx.scale * 1000
        ctx.phase('trickle', { interval_ms: TRICKLE_INTERVAL_MS, window_ms: TRICKLE_WINDOW_MS * ctx.scale })
      }
      const frame = answerFrame(link.transport, request, answerFromTables(ctx.tables, request.pdu))
      if (nowUs() < windowEndUs) {
        link.trickle(frame, TRICKLE_INTERVAL_MS)
      } else {
        link.send(frame)
      }
    },
  }
}

/** AS-07: 0xFF flood for 60 s from the first request, then 4321, 8765 to that request and to every poll group. */
function flood(ctx: Context): Handler {
  let state: 'idle' | 'flooding' | 'answering' = 'idle'
  return {
    handle: (request, link) => {
      if (state === 'idle') {
        state = 'flooding'
        ctx.phase('flood', { duration_ms: FLOOD_MS * ctx.scale })
        link.startFlood()
        ctx.later(FLOOD_MS * ctx.scale, () => {
          state = 'answering'
          link.stopFlood()
          ctx.phase('flood-end')
          answerValues(link, request, RESUME_VALUES)
        })
        return
      }
      if (state === 'flooding') {
        ctx.log({ event: 'withheld', tid: request.tid })
      } else if (groupOf(ctx.groups, request)) {
        answerValues(link, request, RESUME_VALUES)
      } else {
        answerNormally(ctx, link, request)
      }
    },
  }
}

/** AS-10: no reading and no answer for 15 minutes from the first request, then 4321, 8765 to every poll group. */
function readStop(ctx: Context): Handler {
  let state: 'idle' | 'stopped' | 'answering' = 'idle'
  const paused = new Set<SlaveLink>()
  const withheld: Array<{ link: SlaveLink; request: Request }> = []
  const answer = (link: SlaveLink, request: Request): void => {
    if (groupOf(ctx.groups, request)) {
      answerValues(link, request, RESUME_VALUES)
    } else {
      answerNormally(ctx, link, request)
    }
  }
  const stopReading = (link: SlaveLink): void => {
    link.pauseReading()
    paused.add(link)
  }
  return {
    attach: (link) => {
      if (state === 'stopped') {
        stopReading(link)
      }
    },
    detach: (link) => {
      paused.delete(link)
    },
    handle: (request, link) => {
      if (state === 'answering') {
        answer(link, request)
        return
      }
      withheld.push({ link, request })
      if (state === 'stopped') {
        return
      }
      state = 'stopped'
      ctx.phase('read-stop', { duration_ms: READ_STOP_MS * ctx.scale })
      stopReading(link)
      ctx.later(READ_STOP_MS * ctx.scale, () => {
        state = 'answering'
        ctx.phase('read-resume')
        paused.forEach((each) => each.resumeReading())
        paused.clear()
        withheld.splice(0).forEach((each) => answer(each.link, each.request))
      })
    },
  }
}

function as11Hostile(row: number): Buffer {
  if (row === 1) {
    return rtuAdu(SLAVE_UNIT, Buffer.concat([Buffer.from([FC.readHoldingRegisters, 40]), hostileWords(20)]))
  }
  const frame = Buffer.alloc(300)
  frame[0] = SLAVE_UNIT
  frame[1] = FC.readHoldingRegisters
  frame[2] = 20
  hostileWords(149).copy(frame, 3)
  return frame
}

/** AS-11: one malformed RTU answer to G1, then 501..510 on G1. */
function rtuHostile(ctx: Context, row: number): Handler {
  let hostileSent = false
  return {
    handle: (request, link) => {
      if (groupOf(ctx.groups, request) !== 'g1') {
        answerNormally(ctx, link, request)
      } else if (hostileSent) {
        answerValues(link, request, RECOVERY_G1)
      } else {
        hostileSent = true
        ctx.phase('hostile')
        link.send(as11Hostile(row))
      }
    },
  }
}

function buildHandler(scenario: string, ctx: Context, nowUs: () => number): Handler {
  const row = ctx.row ?? 0
  switch (scenario) {
    case 'AS-01':
      return baselineThenHostile(ctx, as01Hostile)
    case 'AS-02':
      return baselineThenHostile(ctx, (request) => as02Hostile(row, request))
    case 'AS-03':
    case 'AS-12':
      return lateResponse(ctx)
    case 'AS-04':
      return delayedWithClient(ctx)
    case 'AS-06':
      return trickle(ctx, nowUs)
    case 'AS-07':
      return flood(ctx)
    case 'AS-10':
      return readStop(ctx)
    case 'AS-11':
      return rtuHostile(ctx, row)
    default:
      return normalScenario(ctx)
  }
}

/** Builds the engine of a scenario; throws when the scenario, row or transport is not accepted. */
export function createScenario(options: ScenarioOptions): ScenarioEngine {
  checkScenario(options.scenario, options.row, options.transport)
  const timers = new Set<unknown>()
  const scale = options.durationScale ?? 1
  if (!(scale > 0)) {
    throw new Error('the duration scale must be a positive number')
  }
  const ctx: Context = {
    transport: options.transport,
    groups: options.groups ?? DEFAULT_GROUPS,
    tables: options.map ?? emptyRegisterMap(),
    scale,
    client: options.client,
    row: options.row,
    log: options.log,
    phase: (name, fields = {}) => options.log({ event: 'phase', phase: name, ...fields }),
    later: (ms, callback) => {
      const handle = options.clock.setTimeout(() => {
        timers.delete(handle)
        callback()
      }, ms)
      timers.add(handle)
    },
  }
  const handler = buildHandler(options.scenario, ctx, options.clock.nowUs)
  return {
    attach: (link) => handler.attach?.(link),
    handle: (request, link) => handler.handle(request, link),
    detach: (link) => handler.detach?.(link),
    stop: () => {
      timers.forEach((handle) => options.clock.clearTimeout(handle))
      timers.clear()
    },
  }
}

/** Options of `runSlave`: the scenario, the stream it answers on and, in the CLI, the engine shared by connections. */
export type SlaveOptions = ScenarioOptions & {
  stream: Duplex
  engine?: ScenarioEngine
  tags?: LogEvent
  floodBlock?: number
}

/** A running slave on one stream. */
export type RunningSlave = { stop: () => void }

/** Runs a scenario's slave role on one TCP connection or serial line, logging every byte and decoded request. */
export function runSlave(options: SlaveOptions): RunningSlave {
  const tags = options.tags ?? {}
  const log: Log = (event) => options.log({ t_us: options.clock.nowUs(), ...tags, ...event })
  const ownsEngine = options.engine === undefined
  const engine = options.engine ?? createScenario({ ...options, log })
  const link = new SlaveLink(
    options.transport,
    options.stream,
    options.clock,
    log,
    options.floodBlock ?? DEFAULT_FLOOD_BLOCK,
  )
  let pending = Buffer.alloc(0)

  const onData = (chunk: Buffer | string): void => {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'latin1') : chunk
    log({ event: 'rx', hex: hex(bytes) })
    const taken =
      options.transport === 'tcp'
        ? takeTcpRequests(Buffer.concat([pending, bytes]))
        : takeRtuRequests(Buffer.concat([pending, bytes]))
    pending = taken.rest
    if (taken.discarded.length > 0) {
      log({ event: 'discarded', hex: hex(taken.discarded) })
    }
    for (const request of taken.requests) {
      const { tid, unit, fc, address, quantity } = request
      log({ event: 'request', tid, unit, fc, address, quantity })
      if (options.transport === 'rtu' && unit !== SLAVE_UNIT) {
        log({ event: 'ignored', unit })
        continue
      }
      engine.handle(request, link)
    }
  }

  let stopped = false
  const stop = (): void => {
    if (stopped) {
      return
    }
    stopped = true
    options.stream.off('data', onData)
    options.stream.off('close', stop)
    link.close()
    engine.detach(link)
    if (ownsEngine) {
      engine.stop()
    }
  }

  options.stream.on('data', onData)
  options.stream.on('close', stop)
  engine.attach(link)
  return { stop }
}
