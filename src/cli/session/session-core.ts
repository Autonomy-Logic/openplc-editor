/**
 * The debug session's behaviour, independent of how requests reach it.
 *
 * Split from the socket server on purpose: this class is what makes the REPL
 * and the one-shot clients the same debugger. Both send `Request`s and get
 * `Response`s; neither can reach a code path the other cannot, because there
 * is only one `handle()`.
 *
 * It owns the state a stateless caller cannot keep:
 *   - the live debug channel and the program MD5 it was verified against;
 *   - which variables THIS session forced, so `close` can release them;
 *   - the watch recording buffer.
 */

import type { RuntimeApiClient } from '@root/backend/editor/runtime/runtime-api-client'
import type { DeviceDebugChannel, PlcControlResult } from '@root/backend/shared/debug/types'
import { PlcRuntimeState } from '@root/backend/shared/simulator/types'
import type { TargetEndian } from '@root/frontend/utils/endian'

import { disconnectAndWait } from '../debug/close-channel'
import {
  type DebugVariableIndex,
  decodeVariableValues,
  encodeValue,
  filterVariables,
  findVariable,
  type ResolvedVariable,
} from '../debug/variables'
import { ErrorCode } from '../exit-codes'
import type { Request, Response, SessionStatus, VariableValue, WatchSample } from './protocol'

/** How a session controls run/stop, which differs by target family. */
export interface PlcControl {
  start(): Promise<{ success: boolean; error?: string }>
  stop(): Promise<{ success: boolean; error?: string }>
  /** Current run state, or 'unknown' when the target cannot be asked. */
  state(): Promise<'running' | 'stopped' | 'unknown'>
}

export interface SessionCoreOptions {
  sessionId: string
  projectPath: string
  target: string
  transport: string
  descriptor: string
  channel: DeviceDebugChannel
  index: DebugVariableIndex
  plc: PlcControl
  /** MD5 the target reported at connect time. */
  programMd5: string | null
  endian: TargetEndian
  /** Largest number of variables one request may carry on this medium. */
  batchSize: number
  /** Clock, injectable so tests are not wall-clock dependent. */
  now?: () => number
}

/** Keeps the watch buffer bounded — a long recording must not grow forever. */
const MAX_WATCH_SAMPLES = 5000
/** How long to wait for an external write to survive a dispatcher drain. */
const WRITE_SETTLE_TIMEOUT_MS = 1500
const WRITE_SETTLE_POLL_MS = 50
const MIN_WATCH_INTERVAL_MS = 20

export class SessionCore {
  private readonly startedAtMs: number
  private readonly startedAt: string
  private lastActivityAtMs: number
  /**
   * Names this session has forced and not released, in their CANONICAL casing —
   * the composite key the GUI shows (`main:SL1_AO1`), not an uppercased form.
   * Lookups go through `isForced`, which compares case-insensitively.
   */
  private readonly forced = new Set<string>()
  private watching: ResolvedVariable[] = []
  private watchTimer: NodeJS.Timeout | null = null
  private watchIntervalMs = 0
  private samples: WatchSample[] = []
  private nextSeq = 1
  private droppedSamples = 0
  private closed = false
  /**
   * Serialises everything that touches the debug channel.
   *
   * The channel is ONE request/response link. `SessionServer` queues client
   * requests for exactly that reason — but the watch timer is a second actor,
   * and it went straight to `readValues`, so a sample could be in flight while a
   * read, a write, a force or an MD5 probe was in flight. Two overlapping
   * exchanges on a single link do not fail cleanly: the replies interleave and
   * BOTH are decoded wrong, which for a debugger means confidently reporting
   * values that were never on the wire.
   */
  private channelChain: Promise<unknown> = Promise.resolve()
  /** True while a sample is queued or running — see `recordSample`. */
  private samplePending = false
  private readonly now: () => number

  constructor(private readonly options: SessionCoreOptions) {
    this.now = options.now ?? (() => Date.now())
    this.startedAtMs = this.now()
    this.startedAt = new Date(this.startedAtMs).toISOString()
    this.lastActivityAtMs = this.startedAtMs
  }

  get sessionId(): string {
    return this.options.sessionId
  }

  get isClosed(): boolean {
    return this.closed
  }

  /** Single entry point. Everything a client can ask goes through here. */
  async handle(request: Request): Promise<Response> {
    this.lastActivityAtMs = this.now()
    // Whole dispatch, not the individual channel calls: a `write` reads back
    // until the value settles, and a sample landing between the set and the
    // read-back would be answering from the middle of someone else's exchange.
    return this.runExclusive(async () => {
      try {
        return await this.dispatch(request)
      } catch (error) {
        return this.fail(request.id, ErrorCode.Internal, error instanceof Error ? error.message : String(error))
      }
    })
  }

  /**
   * Run an operation with exclusive use of the debug channel.
   *
   * Nothing called from inside `operation` may call this again — the chain is a
   * plain queue, not a re-entrant lock, and a nested acquire would wait on
   * itself forever. The two callers are `handle` and `recordSample`, which is
   * the whole point: they are the two independent actors.
   */
  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.channelChain.then(operation)
    // The chain must stay resolvable: one failed operation cannot be allowed to
    // leave every later `.then` skipped, which is a session that stays connected
    // and answers nothing.
    this.channelChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async dispatch(request: Request): Promise<Response> {
    switch (request.kind) {
      case 'status':
        return { id: request.id, ok: true, data: { kind: 'status', status: await this.status() } }

      case 'list-vars': {
        const variables = filterVariables(this.options.index, request.filter).map((variable) => ({
          name: variable.name,
          type: variable.type,
          size: variable.size,
        }))
        return { id: request.id, ok: true, data: { kind: 'list-vars', variables } }
      }

      case 'read': {
        const resolved = this.resolveAll(request.names)
        if ('error' in resolved) return this.fail(request.id, ErrorCode.VariableNotFound, resolved.error)
        const values = await this.readValues(resolved.variables)
        if ('error' in values) return this.fail(request.id, ErrorCode.NotConnected, values.error)
        return { id: request.id, ok: true, data: { kind: 'read', values: values.values } }
      }

      case 'write':
      case 'force':
        return this.applyWrite(request.id, request.name, request.value, request.kind === 'force')

      case 'unforce':
        return this.applyUnforce(request.id, request.name)

      case 'start':
      case 'stop': {
        const control = request.kind === 'start' ? this.options.plc.start() : this.options.plc.stop()
        const result = await control
        if (!result.success) {
          return this.fail(request.id, ErrorCode.TargetError, result.error ?? `Could not ${request.kind} the PLC`)
        }
        if (request.kind === 'stop') {
          // Stopping the program clears the runtime's forces:
          // `debug_write_journal_reset()` runs on program unload/stop. Keeping
          // this session's list afterwards reports `[FORCED]` on variables the
          // program is freely writing again — observed on hardware, where a
          // forced BOOL read back as the program's own value while still
          // flagged. It also makes `close` try to release forces that no longer
          // exist.
          //
          // A stop this session did not issue (the runtime UI, a mode switch)
          // still leaves the list stale: the debug protocol has no read for the
          // forced-slot bitmap, so local bookkeeping is the only source there is.
          // `status` therefore reports what this session forced and has not
          // released, which is what `close` acts on.
          this.forced.clear()
        }
        return {
          id: request.id,
          ok: true,
          data: { kind: 'plc-state', plcState: request.kind === 'start' ? 'running' : 'stopped' },
        }
      }

      case 'watch': {
        const resolved = this.resolveAll(request.names)
        if ('error' in resolved) return this.fail(request.id, ErrorCode.VariableNotFound, resolved.error)
        this.startWatching(resolved.variables, request.intervalMs)
        return {
          id: request.id,
          ok: true,
          data: {
            kind: 'watch',
            watching: this.watching.map((variable) => variable.name),
            intervalMs: this.watchIntervalMs,
          },
        }
      }

      case 'poll': {
        const since = request.since ?? 0
        const samples = this.samples.filter((sample) => sample.seq > since)
        const dropped = this.droppedSamples
        // Drained samples are released; a caller that wants them again should
        // have kept them. Holding everything would make a long watch unbounded.
        this.samples = []
        this.droppedSamples = 0
        return { id: request.id, ok: true, data: { kind: 'poll', samples, dropped } }
      }

      case 'unwatch': {
        if (!request.names || request.names.length === 0) this.stopWatching()
        else {
          const drop = new Set(request.names.map((name) => name.toUpperCase()))
          this.watching = this.watching.filter((variable) => !drop.has(variable.name.toUpperCase()))
          if (this.watching.length === 0) this.stopWatching()
        }
        return {
          id: request.id,
          ok: true,
          data: { kind: 'unwatch', watching: this.watching.map((variable) => variable.name) },
        }
      }

      case 'close': {
        const released = await this.close(request.releaseForces ?? true)
        return { id: request.id, ok: true, data: { kind: 'close', released } }
      }
    }
  }

  private resolveAll(names: readonly string[]): { variables: ResolvedVariable[] } | { error: string } {
    if (names.length === 0) return { error: 'No variable named' }
    const variables: ResolvedVariable[] = []
    for (const name of names) {
      const variable = findVariable(this.options.index, name)
      if (!variable) return { error: `No variable "${name}" in this program's debug map` }
      variables.push(variable)
    }
    return { variables }
  }

  /**
   * Read values, splitting into medium-sized batches.
   *
   * The batch cap is a property of the far end's frame budget, not a tuning
   * knob: overrunning it on RTU produces a request the firmware silently drops.
   */
  private async readValues(
    variables: readonly ResolvedVariable[],
  ): Promise<{ values: VariableValue[] } | { error: string }> {
    const values: VariableValue[] = []
    for (let start = 0; start < variables.length; start += this.options.batchSize) {
      const batch = variables.slice(start, start + this.options.batchSize)
      const result = await this.options.channel.getVariablesList(batch.map((variable) => variable.index))
      if (!result.success || !result.data) {
        return { error: result.error ?? 'The target did not answer the variable read' }
      }
      values.push(
        ...decodeVariableValues({
          requested: batch,
          // `data` is declared `Uint8Array | Buffer` because the Node Modbus
          // clients return the latter and the shared WebSocket transport the
          // former. Normalising here keeps the decoder on one type.
          payload: new Uint8Array(result.data),
          lastIndex: result.lastIndex,
          endian: this.options.endian,
          forced: this.forcedUpper(),
        }),
      )
    }
    return { values }
  }

  private async applyWrite(id: number, name: string, input: string, force: boolean): Promise<Response> {
    const variable = findVariable(this.options.index, name)
    if (!variable) {
      return this.fail(id, ErrorCode.VariableNotFound, `No variable "${name}" in this program's debug map`)
    }
    const encoded = encodeValue(variable, input)
    if (!encoded.success) return this.fail(id, ErrorCode.ValueInvalid, encoded.error)

    const result = await this.options.channel.setVariable(variable.index, force, encoded.bytes)
    if (!result.success) {
      return this.fail(id, ErrorCode.TargetError, result.error ?? `The target refused the ${force ? 'force' : 'write'}`)
    }
    if (force) this.forced.add(variable.name)

    const readBack = await this.readBackAfterWrite(variable, input)
    if ('error' in readBack) return this.fail(id, ErrorCode.NotConnected, readBack.error)
    return { id, ok: true, data: { kind: force ? 'force' : 'write', value: readBack.value } }
  }

  /**
   * Read a variable back after writing it, waiting for the write to land.
   *
   * An external write does NOT take effect immediately: the runtime enqueues it
   * on the debug-write journal and the dispatcher drains it once per cycle, at
   * the no-task-running window. A single read straight after the write therefore
   * races the drain and usually returns the OLD value — so `force x 3.5` would
   * report `0`, and a test asserting on that reply would fail against a PLC that
   * had done exactly what it was told.
   *
   * Polls briefly for the value to match what was asked, and gives up quietly
   * after that: a mismatch is legitimate for a soft `write` the program
   * overwrites on the next scan, so a timeout here is not an error.
   */
  private async readBackAfterWrite(
    variable: ResolvedVariable,
    requested: string,
  ): Promise<{ value: VariableValue } | { error: string }> {
    const deadline = this.now() + WRITE_SETTLE_TIMEOUT_MS
    let last: VariableValue | undefined

    for (;;) {
      const result = await this.readValues([variable])
      if ('error' in result) return { error: result.error }
      last = result.values[0]
      if (last && writeHasSettled(last, requested)) break
      if (this.now() >= deadline) break
      await delay(WRITE_SETTLE_POLL_MS)
    }

    return {
      value: last ?? {
        name: variable.name,
        type: variable.type,
        value: null,
        forced: this.isForced(variable.name),
      },
    }
  }

  private async applyUnforce(id: number, name: string): Promise<Response> {
    const variable = findVariable(this.options.index, name)
    if (!variable) {
      return this.fail(id, ErrorCode.VariableNotFound, `No variable "${name}" in this program's debug map`)
    }
    // force=false with no payload is the unforce PDU — see `buildSetVariableRequest`.
    const result = await this.options.channel.setVariable(variable.index, false)
    if (!result.success) {
      return this.fail(id, ErrorCode.TargetError, result.error ?? 'The target refused the unforce')
    }
    this.unmarkForced(variable.name)

    // No expected value to wait for: unforcing hands the variable back to the
    // program, so whatever it reads next is legitimate.
    const readBack = await this.readValues([variable])
    if ('error' in readBack) return this.fail(id, ErrorCode.NotConnected, readBack.error)
    const value = readBack.values[0] ?? { name: variable.name, type: variable.type, value: null, forced: false }
    return { id, ok: true, data: { kind: 'unforce', value } }
  }

  private startWatching(variables: ResolvedVariable[], intervalMs: number | undefined): void {
    this.stopWatching()
    this.watching = variables
    this.watchIntervalMs = Math.max(MIN_WATCH_INTERVAL_MS, intervalMs ?? 100)
    this.watchTimer = setInterval(() => {
      void this.recordSample()
    }, this.watchIntervalMs)
    // Do not hold the process open on the timer alone; the socket server does that.
    this.watchTimer.unref()
  }

  private stopWatching(): void {
    if (this.watchTimer) clearInterval(this.watchTimer)
    this.watchTimer = null
    this.watching = []
    this.watchIntervalMs = 0
  }

  private async recordSample(): Promise<void> {
    if (this.watching.length === 0 || this.closed || this.samplePending) return
    // Dropped, not queued. The interval floor is 20 ms and one batched RTU read
    // takes far longer, so without this the ticks pile up behind each other and
    // every one of them eventually fires — a burst of samples all stamped with
    // the time they finally ran, describing a signal that never looked like
    // that.
    this.samplePending = true
    const watching = this.watching
    try {
      const result = await this.runExclusive(async () => {
        // Re-checked after acquiring: this tick may have been queued behind the
        // close that ended the session.
        if (this.closed) return { error: 'session closed' }
        return this.readValues(watching)
      })
      if ('error' in result) return
      this.storeSample(result.values)
    } finally {
      this.samplePending = false
    }
  }

  private storeSample(values: VariableValue[]): void {
    if (this.samples.length >= MAX_WATCH_SAMPLES) {
      // Drop the oldest and COUNT it. A silently truncated recording would let
      // a test conclude a transient never happened when it was simply evicted.
      this.samples.shift()
      this.droppedSamples += 1
    }
    this.samples.push({ seq: this.nextSeq++, atMs: this.now() - this.startedAtMs, values })
  }

  private async status(): Promise<SessionStatus> {
    const md5 = await this.readMd5()
    return {
      sessionId: this.options.sessionId,
      connected: !this.closed,
      target: this.options.target,
      transport: this.options.transport,
      descriptor: this.options.descriptor,
      projectPath: this.options.projectPath,
      programMd5: md5 ?? this.options.programMd5,
      md5Matches: (md5 ?? this.options.programMd5)?.toLowerCase() === this.options.index.md5.toLowerCase(),
      plcState: await this.options.plc.state(),
      forced: [...this.forced].sort(),
      watching: this.watching.map((variable) => variable.name),
      startedAt: this.startedAt,
      lastActivityAt: new Date(this.lastActivityAtMs).toISOString(),
    }
  }

  private async readMd5(): Promise<string | null> {
    try {
      const probe = await this.options.channel.getMd5Hash()
      return probe.md5 ?? null
    } catch {
      return null
    }
  }

  /**
   * Release forces (by default), stop recording, drop the channel.
   *
   * The default matters: forcing lives in the runtime's forced-slot bitmap, and
   * the runtime cannot notice a debugger going away — it clears forces only on
   * program unload/stop. A session that exited quietly would leave outputs
   * pinned on a live PLC, and a test loop would strand them on real hardware.
   */
  /**
   * Close from OUTSIDE a request: the idle timer and the signal handlers.
   *
   * Takes the channel lock, which the in-request path must NOT do because it
   * already holds it. Worth the distinction: watching is not activity, so a
   * session can be idle by the timer's reckoning while its watch timer is still
   * sampling — and releasing forces in the middle of a sample interleaves two
   * exchanges on a one-at-a-time link.
   */
  async closeFromOutsideRequest(releaseForces: boolean): Promise<string[]> {
    return this.runExclusive(() => this.close(releaseForces))
  }

  async close(releaseForces: boolean): Promise<string[]> {
    this.stopWatching()
    const released: string[] = []
    if (releaseForces) {
      for (const heldName of [...this.forced]) {
        const variable = findVariable(this.options.index, heldName)
        /* istanbul ignore if -- every entry was resolved before being forced */
        if (!variable) continue
        try {
          const result = await this.options.channel.setVariable(variable.index, false)
          if (result.success) released.push(variable.name)
        } catch {
          // Best effort: a channel that is already gone cannot be told to
          // unforce, and failing the close would leave the session registered.
        }
      }
    }
    this.forced.clear()
    this.closed = true
    // Waits for the transport's native handle to release — see `disconnectAndWait`.
    await disconnectAndWait(this.options.channel)
    return released
  }

  /** Case-insensitive membership, so a caller's casing never changes the answer. */
  private isForced(name: string): boolean {
    return this.forcedUpper().has(name.toUpperCase())
  }

  private forcedUpper(): Set<string> {
    return new Set([...this.forced].map((name) => name.toUpperCase()))
  }

  private unmarkForced(name: string): void {
    for (const held of this.forced) {
      if (held.toUpperCase() === name.toUpperCase()) this.forced.delete(held)
    }
  }

  private fail(id: number, code: (typeof ErrorCode)[keyof typeof ErrorCode], message: string): Response {
    return { id, ok: false, error: { code, message } }
  }
}

/**
 * Run/stop for a Runtime v3/v4.
 *
 * Delegates to `RuntimeApiClient.setPlcState`, the same method the GUI's
 * Start/Stop button reaches through `MainProcessBridge.restSetPlcState`. That
 * matters for more than tidiness: the runtime answers these routes over GET and
 * reports refusal in the BODY (`ERROR_SWITCH_STOP` when a hardware mode switch
 * gates a start), and a CLI that reimplemented the call got both wrong.
 */
export function restPlcControl(client: RuntimeApiClient, address: string): PlcControl {
  const describe = (result: PlcControlResult, action: string): { success: boolean; error?: string } => {
    if (result.success) return { success: true }
    if (result.refusedBySwitch) {
      return {
        success: false,
        error: `The PLC cannot be ${action}: its physical mode switch is in STOP. Move it to RUN and retry.`,
      }
    }
    return { success: false, error: result.error ?? `The PLC could not be ${action}` }
  }

  return {
    start: async () => describe(await client.setPlcState(address, 'run'), 'started'),
    stop: async () => describe(await client.setPlcState(address, 'stop'), 'stopped'),
    async state() {
      const result = await client.getStatus(address)
      if (!result.success || !result.status) return 'unknown'
      const status = result.status.toLowerCase()
      if (status.includes('running')) return 'running'
      if (status.includes('stopped')) return 'stopped'
      return 'unknown'
    },
  }
}

/** Run/stop for a baremetal target, which answers it on the debug channel itself. */
export function channelPlcControl(channel: DeviceDebugChannel): PlcControl {
  return {
    async start() {
      if (!channel.setPlcState) return { success: false, error: 'This target does not support run/stop control' }
      const result = await channel.setPlcState(PlcRuntimeState.RUNNING)
      return result.success ? { success: true } : { success: false, error: result.error }
    },
    async stop() {
      if (!channel.setPlcState) return { success: false, error: 'This target does not support run/stop control' }
      const result = await channel.setPlcState(PlcRuntimeState.STOPPED)
      return result.success ? { success: true } : { success: false, error: result.error }
    },
    async state() {
      if (!channel.getStatus) return 'unknown'
      const result = await channel.getStatus()
      if (!result.success) return 'unknown'
      if (result.plcState === undefined) return result.running ? 'running' : 'unknown'
      // Compared as a number: `plcState` arrives as a raw byte off the wire, not
      // as a member of the enum, so an enum-typed comparison would be a lie.
      return result.plcState === Number(PlcRuntimeState.RUNNING) ? 'running' : 'stopped'
    },
  }
}

/**
 * Should the read-back poll stop?
 *
 * Named for what it decides, not for what the caller hopes: it returns true both
 * when the value MATCHES the request and when the two cannot be compared at all
 * (a non-boolean string against a BOOL, an unparseable number, a formatted TIME
 * literal). Calling it `valueMatchesRequest` asserted more than it computed — a
 * reader would conclude a write had landed when the code had merely given up.
 *
 * Giving up is the right behaviour here: the value is reported to the caller
 * either way, and a soft `write` the program overwrites next scan is legitimate,
 * so an incomparable read-back must not spin for the whole timeout.
 *
 * Compared as text after normalising, because the request is a user string
 * (`TRUE`, `3.5`, `16#FF`) and the reply is a typed value. Exact float equality
 * is avoided deliberately: a value the target rounds would never compare equal.
 */
function writeHasSettled(value: VariableValue, requested: string): boolean {
  const wanted = requested.trim().toUpperCase()
  if (typeof value.value === 'boolean') {
    const asTrue = wanted === 'TRUE' || wanted === '1'
    const asFalse = wanted === 'FALSE' || wanted === '0'
    if (!asTrue && !asFalse) return true
    return value.value === asTrue
  }
  if (typeof value.value === 'number') {
    const parsed = Number(wanted.replace(/^16#/, '0x'))
    return Number.isNaN(parsed) ? true : Math.abs(value.value - parsed) < 1e-6
  }
  if (typeof value.value === 'string') return value.value.toUpperCase() === wanted
  return true
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
