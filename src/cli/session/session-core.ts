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
const MIN_WATCH_INTERVAL_MS = 20

export class SessionCore {
  private readonly startedAtMs: number
  private readonly startedAt: string
  private lastActivityAtMs: number
  /** UPPERCASE canonical names this session has forced and not released. */
  private readonly forced = new Set<string>()
  private watching: ResolvedVariable[] = []
  private watchTimer: NodeJS.Timeout | null = null
  private watchIntervalMs = 0
  private samples: WatchSample[] = []
  private nextSeq = 1
  private droppedSamples = 0
  private closed = false
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
    try {
      return await this.dispatch(request)
    } catch (error) {
      return this.fail(request.id, ErrorCode.Internal, error instanceof Error ? error.message : String(error))
    }
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
          forced: this.forced,
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
    if (force) this.forced.add(variable.name.toUpperCase())

    const readBack = await this.readValues([variable])
    if ('error' in readBack) return this.fail(id, ErrorCode.NotConnected, readBack.error)
    const value = readBack.values[0] ?? {
      name: variable.name,
      type: variable.type,
      value: null,
      forced: this.forced.has(variable.name.toUpperCase()),
    }
    return { id, ok: true, data: { kind: force ? 'force' : 'write', value } }
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
    this.forced.delete(variable.name.toUpperCase())

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
    if (this.watching.length === 0 || this.closed) return
    const result = await this.readValues(this.watching)
    if ('error' in result) return
    if (this.samples.length >= MAX_WATCH_SAMPLES) {
      // Drop the oldest and COUNT it. A silently truncated recording would let
      // a test conclude a transient never happened when it was simply evicted.
      this.samples.shift()
      this.droppedSamples += 1
    }
    this.samples.push({ seq: this.nextSeq++, atMs: this.now() - this.startedAtMs, values: result.values })
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
  async close(releaseForces: boolean): Promise<string[]> {
    this.stopWatching()
    const released: string[] = []
    if (releaseForces) {
      for (const upperName of [...this.forced]) {
        const variable = findVariable(this.options.index, upperName)
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
    try {
      this.options.channel.disconnect()
    } catch {
      /* already disconnected */
    }
    return released
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
