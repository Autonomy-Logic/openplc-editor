/**
 * THE session with a device: what it is reached through, and by whom.
 *
 * A session has two channel slots — CONTROL (run/stop, status) and DEBUG
 * (variables, md5, licensing) — because that is the shape real targets have:
 *
 *   - a baremetal board answers both over ONE Modbus connection, serial or TCP;
 *   - a Runtime v3/v4 is controlled over REST but debugged over something else
 *     entirely (Modbus TCP / a WebSocket);
 *   - the simulator answers both over its in-process virtual serial port.
 *
 * When both roles share a medium the two slots hold the SAME channel, so nothing
 * opens twice and releasing the debug role cannot close the connection out from
 * under run/stop. When they differ the debug channel is opened on request and
 * closed when the last requester lets go — an independent channel, whose failure
 * leaves control untouched.
 *
 * Whatever the shape, every caller shares what the session holds: the debugger,
 * run/stop, the status poll, licensing.
 * That single-ownership rule is the point of this module. Before it, three
 * places opened their own client for the same device (the debug session, the two
 * lazy-reconnect paths, and a transient one per run/stop command), and each had
 * its own idea of which transport counted as reusable. A run/stop command with a
 * live Modbus TCP session therefore opened a SECOND socket to the board — which
 * an Arduino Modbus TCP server, serving one client at a time, never answered, so
 * the command failed with a bare timeout while a perfectly good connection sat
 * idle.
 *
 * Transport is a detail here, not a branch. Both Modbus clients implement
 * `DeviceModbusTransport`, so this module never asks which one it holds except to
 * describe it to the user and to know whether a vanished serial port applies.
 *
 * What the manager does NOT decide:
 *   - which candidates to try, or in what order  -> the caller resolves those
 *     from the board's debug spec (Modbus TCP first when the project enables it,
 *     serial otherwise), so this works for every baremetal target rather than
 *     any particular board;
 *   - what "this is really the device" means      -> `hooks.verify`, which the
 *     main process implements as its existing classify + license recover;
 *   - the counting for down / back / lost         -> `DeviceLinkPolicy`.
 */
import type { DebugMedium, DeviceLinkTransport } from '../../../middleware/shared/ports/types'
import type { DeviceDebugChannel, DeviceModbusTransport } from '../../shared/debug/types'
import { DeviceLinkPolicy } from './device-link-policy'

// Re-exported so callers in this layer keep one import site; the definition is
// shared with the renderer, which mirrors these media into the store.
export type { DebugMedium, DeviceLinkTransport }

/**
 * How to open a DEBUG channel that is not the control channel. Simpler than a
 * control candidate: there is nothing to choose between and nothing to classify —
 * the control side already established what this target is.
 */
export interface DeviceDebugCandidate {
  /**
   * Medium this channel rides. Published with the session status because the debug
   * poll sizes its batches to the frame budget (a WebSocket swallows 500 variables
   * per round trip, Modbus TCP 60, RTU 19), and a poller that has to GUESS the
   * medium either wastes round trips or overruns a frame.
   */
  transport: DebugMedium
  descriptor: string
  create: () => DeviceDebugChannel
}

/** One way to reach the device, ready to be tried. */
export interface DeviceLinkCandidate {
  transport: DeviceLinkTransport
  /**
   * What the user calls this endpoint: "/dev/cu.usbmodem11101", "192.168.0.50".
   *
   * This is an IDENTIFIER, not a caption: it is matched against the OS port list
   * (`serialPortPresent`) and against the port an upload asks to borrow. Anything
   * decorative belongs in `baudRate` or the trace, never here — a descriptor that
   * read "COM5 @ 9600 baud" matched no port and no upload.
   */
  descriptor: string
  /**
   * Wire speed for a serial candidate, carried so the trace can name it. Two
   * candidates on one port differ only by this, and a log that repeated the port
   * five times said nothing about what was actually tried.
   */
  baudRate?: number
  /** Build an unconnected client for this candidate. */
  create: () => DeviceModbusTransport
  /**
   * A guess rather than something the project declared (an alternative baud
   * rate). Verification spends a short budget on these — there may be several,
   * and being wrong about one must not delay the next.
   */
  speculative?: boolean
  /**
   * Worth waiting for. Set on the last candidate the project actually declared,
   * so it keeps the patient probe budget even when speculative candidates queue
   * up behind it — a board that was just flashed is still booting, and that wait
   * belongs to the configured endpoint, not to a guess.
   */
  patient?: boolean
}

/** Live link state, as pushed to the renderer. */
export interface DeviceLinkStatus {
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  /**
   * The CONTROL channel's medium. Absent for a REST-controlled session (v3/v4):
   * REST holds no connection, so there is no medium to report or lose.
   */
  transport?: DeviceLinkTransport
  /**
   * The DEBUG channel's medium — the same as `transport` when one channel serves
   * both roles, and `websocket` (v4) or `tcp` (v3) when it does not. Reported
   * separately because these are genuinely two facts: the control medium decides
   * what "the connection dropped" means, the debug medium decides the poll's frame
   * budget.
   */
  debugTransport?: DebugMedium
  descriptor?: string
  /**
   * Set only when a link that WAS up died and could not be recovered. The one
   * status the user must be told about; every other 'error' came straight out of
   * something they just clicked and already has its own dialog.
   */
  reason?: 'lost'
}

export interface DeviceLinkOpenSuccess {
  ok: true
  transport: DeviceLinkTransport
  descriptor: string
  client: DeviceModbusTransport
}

export interface DeviceLinkOpenFailure {
  ok: false
  /** Every candidate that was tried, with why it did not work. */
  attempts: Array<{ transport: DeviceLinkTransport; descriptor: string; baudRate?: number; error: string }>
}

export type DeviceLinkOpenResult = DeviceLinkOpenSuccess | DeviceLinkOpenFailure

/**
 * How a candidate reads in the trace and in a failure message: the endpoint plus
 * its wire speed, when it has one.
 *
 * Derived here rather than baked into `descriptor`, because that field is matched
 * against OS port names and upload requests — see the note on it.
 */
export function describeLinkCandidate(candidate: {
  transport: DeviceLinkTransport
  descriptor: string
  baudRate?: number
}): string {
  const speed = candidate.baudRate === undefined ? '' : ` @ ${candidate.baudRate} baud`
  return `${candidate.transport} ${candidate.descriptor}${speed}`
}

export interface DeviceLinkHooks {
  /**
   * Is this freshly opened client really a device we can work with? Decides
   * whether to keep a candidate or move on to the next one, so a Modbus TCP
   * socket that opens but answers nothing correctly falls back to serial.
   *
   * The main process implements this as its classify + license recover, which is
   * why it runs on open only — see `probe` for the per-tick check.
   */
  verify: (
    client: DeviceModbusTransport,
    candidate: DeviceLinkCandidate,
    context: { isLastCandidate: boolean },
  ) => Promise<boolean>
  /**
   * Cheap liveness read on the held client, also used to confirm a reopen. Kept
   * separate from `verify` so recovery does not re-run licensing every couple of
   * seconds for as long as a cable is out.
   */
  probe: (client: DeviceModbusTransport) => Promise<boolean>
  /** Is this serial port still enumerated by the OS? */
  serialPortPresent: (port: string) => Promise<boolean>
  /** Report a link state change to the renderer. */
  emit: (status: DeviceLinkStatus) => void
  /**
   * Diagnostic trace of every decision this manager makes: which candidate was
   * tried, how long its connect took, why it was kept or rejected, what each poll
   * concluded. Optional, but in practice always supplied — a connection flow that
   * spans two transports and a remote board cannot be diagnosed by watching the UI.
   */
  log?: (message: string) => void
}

export interface DeviceLinkTimings {
  pollIntervalMs: number
  failuresBeforeRecovery: number
  maxRecoveryAttempts: number
}

/** Fail fast, but not so fast that noise reopens a port. See DeviceLinkPolicy. */
export const DEFAULT_DEVICE_LINK_TIMINGS: DeviceLinkTimings = {
  pollIntervalMs: 2500,
  failuresBeforeRecovery: 2,
  maxRecoveryAttempts: 2,
}

export class DeviceSessionManager {
  /** The control channel's client, and the debug channel's too when shared. */
  private client: DeviceModbusTransport | null = null
  private current: DeviceLinkCandidate | null = null
  /**
   * Debug channel, when it is NOT the control channel: its client (null until
   * something asks for it) and how to open it.
   */
  private debugClientHeld: DeviceDebugChannel | null = null
  private debugCandidate: DeviceDebugCandidate | null = null
  /**
   * Who currently wants the debug channel, by reason. A set rather than a counter
   * so the trace can say who is holding it, and so a double release from one
   * caller cannot close a channel another still needs.
   */
  private readonly debugHolders = new Set<string>()
  /**
   * Runtime targets (v3/v4) are CONTROLLED over REST, which is connectionless:
   * there is no socket to hold, poll or recover, so the session records the address
   * and routes control operations to the HTTP client instead of holding a channel.
   * That is why this slot is an address rather than a client — and why polling and
   * recovery below apply only to a Modbus control channel.
   */
  private restControl: { address: string } | null = null
  /** The full list the link was opened from, so recovery can try them all again. */
  private candidates: DeviceLinkCandidate[] = []
  private readonly policy: DeviceLinkPolicy
  private timer: ReturnType<typeof setInterval> | null = null
  private tickInFlight = false
  /** When a command last succeeded over the link. 0 = nothing since it opened. */
  private lastTrafficAt = 0

  constructor(
    private readonly hooks: DeviceLinkHooks,
    private readonly timings: DeviceLinkTimings = DEFAULT_DEVICE_LINK_TIMINGS,
  ) {
    this.policy = new DeviceLinkPolicy(timings.failuresBeforeRecovery, timings.maxRecoveryAttempts)
  }

  private trace(message: string): void {
    this.hooks.log?.(message)
  }

  /**
   * A command just succeeded over the held link.
   *
   * This is liveness evidence, and better evidence than the poll's own read: it
   * already happened, and it cost nothing extra. The poll uses it to skip its
   * round trip entirely (see `probeVerdict`).
   *
   * Why that matters, not merely as an optimisation: a debug session polls
   * variables continuously, and every request queues on the ONE serial link.
   * On a slow wire the status read waits behind that traffic, times out, and two
   * such timeouts enter recovery — tearing down a debug session over a link that
   * was demonstrably working, which is what the traffic proves. Measured on a
   * 9600-baud ESP8266: the debugger died roughly every ten seconds while its own
   * reads kept succeeding.
   */
  noteTraffic(): void {
    this.lastTrafficAt = Date.now()
  }

  /**
   * The CONTROL channel's client, or null when nothing is connected (including
   * mid-recovery). Run/stop and the status poll go here.
   */
  getClient(): DeviceModbusTransport | null {
    return this.client
  }

  /**
   * The DEBUG channel's client, or null when it is not open.
   *
   * For a shared session this IS the control client, so it needs no acquiring and
   * cannot be closed independently. For a session whose debug medium differs, it
   * is null until someone calls `acquireDebugChannel`.
   */
  getDebugClient(): DeviceDebugChannel | null {
    return this.debugCandidate ? this.debugClientHeld : this.client
  }

  /** True when one medium serves both roles, so the slots hold the same channel. */
  isDebugShared(): boolean {
    return this.debugCandidate === null
  }

  /**
   * Open the debug channel if it isn't already, and record `reason` as a holder.
   *
   * Independent of control on purpose: a debug channel that will not open is
   * reported to whoever asked, and the control connection carries on. For a shared
   * session there is nothing to open — the answer is the control channel, and the
   * session having been established is the only precondition.
   */
  async acquireDebugChannel(reason: string): Promise<{ client: DeviceDebugChannel } | { error: string }> {
    if (this.debugCandidate === null) {
      if (!this.client) return { error: 'Not connected' }
      // (A REST session always has a debug candidate, so it never lands here.)
      this.debugHolders.add(reason)
      return { client: this.client }
    }

    if (this.debugClientHeld) {
      this.debugHolders.add(reason)
      return { client: this.debugClientHeld }
    }

    // No trace on open/close: the channel is acquired per licence call and
    // released in the finally, so tracing each one floods the console during
    // the purchase poll (one open+close pair every tick). Failures still trace.
    let client: DeviceDebugChannel
    try {
      client = this.debugCandidate.create()
      await client.connect()
    } catch (error) {
      this.trace(`debug channel: could not open: ${describeError(error)} (control connection unaffected)`)
      return { error: describeError(error) }
    }
    this.debugClientHeld = client
    this.debugHolders.add(reason)
    return { client }
  }

  /**
   * Let go of the debug channel. It closes only once nothing holds it AND it is a
   * channel of its own — releasing a shared one must never take the connection
   * that run/stop and the status poll are using.
   */
  releaseDebugChannel(reason: string): void {
    this.debugHolders.delete(reason)
    if (this.debugHolders.size > 0) return
    if (this.debugCandidate === null || !this.debugClientHeld) return
    this.debugClientHeld.disconnect()
    this.debugClientHeld = null
  }

  /** Transport + endpoint of the held link, for messages and handoff decisions. */
  getLink(): { transport: DeviceLinkTransport; descriptor: string } | null {
    if (!this.current) return null
    return { transport: this.current.transport, descriptor: this.current.descriptor }
  }

  /** True while the link is down and reopens are being attempted. */
  isRecovering(): boolean {
    return this.policy.recovering
  }

  isConnected(): boolean {
    return this.client !== null || this.restControl !== null
  }

  /**
   * Open the first candidate that works and hold it.
   *
   * Candidates are tried IN ORDER and the first one to both connect and verify
   * wins; a candidate that connects but fails verification is closed before the
   * next is tried, so no stray handles are left behind. If none work the attempt
   * fails, reporting what was tried — an editor that claimed "connected" without
   * a working connection is what made every later request time out mysteriously.
   *
   * A fresh open supersedes any held link (reconnect, transport change).
   */
  async open(
    candidates: DeviceLinkCandidate[],
    options: {
      /**
       * How to reach this target for DEBUG when that is a different medium from
       * control (Runtime v3/v4). Omit when one medium serves both — the slots then
       * share a channel, which is what keeps a debug session from opening a second
       * connection to a device that only answers one.
       */
      debugChannel?: DeviceDebugCandidate
    } = {},
  ): Promise<DeviceLinkOpenResult> {
    this.close({ silent: true })
    this.debugCandidate = options.debugChannel ?? null

    if (candidates.length === 0) {
      this.trace('open: refused, no usable candidate was resolved')
      // Still report a settled state. The `close({ silent: true })` above suppressed
      // its own notification on the assumption that this open would publish one, so
      // returning quietly here leaves the renderer showing 'connecting' forever —
      // and its Connect button disabled with no way back.
      this.hooks.emit({ status: 'disconnected' })
      return { ok: false, attempts: [] }
    }

    this.candidates = candidates
    const attempts: DeviceLinkOpenFailure['attempts'] = []

    for (const [index, candidate] of candidates.entries()) {
      // The plan is only worth stating once something went wrong. On the ordinary
      // connection the first candidate answers, and listing four baud rates nobody
      // will dial just buries the two lines that matter. The moment a fallback IS
      // in play, the order becomes the thing you need to read.
      if (index === 1) {
        this.trace(
          `open: falling back — ${candidates.length} candidate(s): ${candidates.map(describeLinkCandidate).join(', ')}`,
        )
      }
      this.hooks.emit({ status: 'connecting', transport: candidate.transport, descriptor: candidate.descriptor })

      const startedAt = Date.now()
      const outcome = await this.tryCandidate(candidate, { isLastCandidate: index === candidates.length - 1 })
      // Only a rejection is traced. Acceptance is already announced by the
      // `connected` status that follows, with the same descriptor.
      if (!outcome.ok) {
        this.trace(
          `open: ${describeLinkCandidate(candidate)} rejected in ${Date.now() - startedAt}ms — ${outcome.error}`,
        )
      }
      if (outcome.ok) {
        this.client = outcome.client
        this.current = candidate
        this.policy.reset()
        // Deliberately NOT seeding `lastTrafficAt` from the verify that just
        // passed: nothing else is on the link yet, so letting the first tick do
        // its own read costs nothing and keeps the poll's behaviour on a fresh
        // connection exactly as it was.
        this.startPolling()
        this.hooks.emit({
          status: 'connected',
          transport: candidate.transport,
          // Shared unless the caller supplied a separate debug channel.
          debugTransport: this.debugCandidate?.transport ?? candidate.transport,
          descriptor: candidate.descriptor,
        })
        return { ok: true, transport: candidate.transport, descriptor: candidate.descriptor, client: outcome.client }
      }
      attempts.push({
        transport: candidate.transport,
        descriptor: candidate.descriptor,
        baudRate: candidate.baudRate,
        error: outcome.error,
      })
    }

    this.candidates = []
    this.trace('open: FAILED, no candidate answered')
    this.hooks.emit({ status: 'disconnected' })
    return { ok: false, attempts }
  }

  /**
   * Establish a session with a target CONTROLLED over REST (Runtime v3/v4).
   *
   * Nothing is opened here. REST needs no connection, and the debug channel is
   * deliberately left shut until something asks for it — a user who logs in to look
   * at logs or start the PLC should not be made to hold a debug channel open, and
   * for v3 that channel is a second Modbus connection to the same box.
   */
  openRestSession(options: { address: string; debugChannel: DeviceDebugCandidate }): void {
    this.close({ silent: true })
    this.restControl = { address: options.address }
    this.debugCandidate = options.debugChannel
    this.trace(`session: control over REST at ${options.address}, debug via ${options.debugChannel.descriptor}`)
    this.hooks.emit({
      status: 'connected',
      // No control transport: REST holds nothing. The debug medium is what the
      // debugger will actually ride, and what its poll must be sized for.
      debugTransport: options.debugChannel.transport,
      descriptor: options.address,
    })
  }

  /** The REST address when control runs over REST, else null. */
  getRestAddress(): string | null {
    return this.restControl?.address ?? null
  }

  /** Open + verify a single candidate, leaving nothing open on failure. */
  private async tryCandidate(
    candidate: DeviceLinkCandidate,
    context: { isLastCandidate: boolean },
  ): Promise<{ ok: true; client: DeviceModbusTransport } | { ok: false; error: string }> {
    // A serial candidate whose port is not even enumerated cannot be opened:
    // say so instead of waiting out a connect timeout.
    if (candidate.transport === 'rtu' && !(await this.hooks.serialPortPresent(candidate.descriptor))) {
      this.trace(`  ${describeLinkCandidate(candidate)}: serial port is not enumerated, skipping`)
      return { ok: false, error: `${candidate.descriptor} is not available` }
    }

    let client: DeviceModbusTransport
    try {
      client = candidate.create()
    } catch (error) {
      return { ok: false, error: describeError(error) }
    }

    const connectStartedAt = Date.now()
    try {
      // Nothing traced on success: opening is a step towards the answer, not the
      // answer. Only failing to open is news.
      await client.connect()
    } catch (error) {
      client.disconnect()
      this.trace(
        `  ${describeLinkCandidate(candidate)}: transport would not open after ${Date.now() - connectStartedAt}ms`,
      )
      return { ok: false, error: describeError(error) }
    }

    // Opening proves an endpoint, not a PLC. A Modbus TCP socket to something
    // that is not an OpenPLC target connects instantly and then answers nothing,
    // so this is the step that decides whether to keep the candidate.
    const verifyStartedAt = Date.now()
    try {
      if (await this.hooks.verify(client, candidate, context)) return { ok: true, client }
      client.disconnect()
      this.trace(
        `  ${describeLinkCandidate(candidate)}: opened but did NOT answer the debug protocol (waited ${Date.now() - verifyStartedAt}ms)`,
      )
      return { ok: false, error: 'No OpenPLC firmware answered' }
    } catch (error) {
      client.disconnect()
      this.trace(`  ${describeLinkCandidate(candidate)}: verification threw after ${Date.now() - verifyStartedAt}ms`)
      return { ok: false, error: describeError(error) }
    }
  }

  /**
   * Close the held link. `silent` skips the renderer notification, for the case
   * where a new open is about to report its own state.
   */
  close(options: { silent?: boolean } = {}): void {
    this.stopPolling()
    this.policy.reset()
    this.debugHolders.clear()
    if (this.debugClientHeld) {
      this.debugClientHeld.disconnect()
      this.debugClientHeld = null
    }
    this.debugCandidate = null
    const hadRest = this.restControl !== null
    this.restControl = null
    const had = this.client !== null || hadRest
    if (had) this.trace(`close: dropping ${this.current?.transport ?? (hadRest ? 'rest' : '?')} session`)
    this.dropClient()
    this.current = null
    this.candidates = []
    if (had && !options.silent) this.hooks.emit({ status: 'disconnected' })
  }

  /**
   * Give up the link if it holds `port` — the handoff before an upload takes the
   * same serial port. Returns whether anything was released, so the caller knows
   * whether to reconnect afterwards.
   *
   * A link running over Modbus TCP is untouched: flashing over USB does not
   * disturb it, so debugging and run/stop keep working across an upload.
   */
  releaseSerialPort(port: string | null | undefined): boolean {
    if (!this.current || this.current.transport !== 'rtu') {
      this.trace(`release ${String(port)}: nothing to release (held: ${this.current?.transport ?? 'none'})`)
      return false
    }
    if (port !== undefined && port !== null && this.current.descriptor !== String(port)) {
      this.trace(`release ${String(port)}: held connection is on ${this.current.descriptor}, leaving it alone`)
      return false
    }
    this.trace(`release ${this.current.descriptor}: handing the port over for an upload`)
    this.close()
    return true
  }

  private dropClient(): void {
    this.client?.disconnect()
    this.client = null
    // Traffic over a client we just dropped proves nothing about the next one.
    this.lastTrafficAt = 0
  }

  private startPolling(): void {
    this.stopPolling()
    this.timer = setInterval(() => {
      if (this.tickInFlight) return
      this.tickInFlight = true
      void this.tick().finally(() => {
        this.tickInFlight = false
      })
    }, this.timings.pollIntervalMs)
  }

  private stopPolling(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  /**
   * One step of the link's lifecycle: probe the held client, or make a single
   * reopen attempt while recovering. Public so it can be driven directly in
   * tests instead of waiting on a timer.
   */
  async tick(): Promise<void> {
    if (this.policy.recovering) return this.attemptRecovery()

    const client = this.client
    const candidate = this.current
    if (!client || !candidate) return

    const verdict = await this.probeVerdict(client, candidate)
    const decision = this.policy.onProbeResult(verdict)
    if (verdict !== 'alive') {
      this.trace(`poll: ${describeLinkCandidate(candidate)} ${verdict} -> ${decision}`)
    }
    switch (decision) {
      case 'enter-recovery':
        // Drop the dead handle but KEEP the link: a stale open fd is what makes
        // the reopen fail with "cannot lock port", while the candidate list is
        // what lets the next ticks bring it back with nothing for the user to do.
        this.dropClient()
        this.hooks.emit({ status: 'connecting', transport: candidate.transport, descriptor: candidate.descriptor })
        return
      case 'fail-now':
        return this.declareLost(candidate)
      default:
        return
    }
  }

  /** Classify one probe of the held client. */
  private async probeVerdict(
    client: DeviceModbusTransport,
    candidate: DeviceLinkCandidate,
  ): Promise<'alive' | 'unresponsive' | 'gone'> {
    // Check the endpoint first: a pulled USB cable is not a slow device, and
    // treating it as one would spend the whole failure budget waiting for
    // timeouts on a port that no longer exists. Deliberately BEFORE the traffic
    // shortcut below: the port list is local and instant, so a yanked cable is
    // still caught on the very next tick.
    if (candidate.transport === 'rtu' && !(await this.hooks.serialPortPresent(candidate.descriptor))) {
      return 'gone'
    }
    // Something already answered within this interval, so the link is up and
    // asking again would only add traffic to a wire that is evidently busy —
    // and on a slow one, queue behind it and time out. See `noteTraffic`.
    if (this.lastTrafficAt > 0 && Date.now() - this.lastTrafficAt < this.timings.pollIntervalMs) {
      return 'alive'
    }
    try {
      return (await this.hooks.probe(client)) ? 'alive' : 'unresponsive'
    } catch {
      return 'unresponsive'
    }
  }

  /**
   * One reopen attempt while recovering. Tries the SAME candidate list the link
   * was opened from, so a device that comes back on either transport is picked
   * up — and a serial port that has not reappeared is skipped without cost.
   *
   * Verification here is the cheap `probe`, not `verify`: the classification and
   * license recover from the original open still stand, and re-running them every
   * couple of seconds while a cable is out would hammer the licensing backend.
   */
  private async attemptRecovery(): Promise<void> {
    const previous = this.current
    if (!previous) return

    const reopened = await this.reopen()
    this.trace(
      `recovery: attempt ${this.policy.attempts + 1} ${reopened ? `restored over ${reopened.candidate.transport}` : 'failed'}`,
    )

    switch (this.policy.onReopenResult(reopened !== null)) {
      case 'recovered':
        this.client = reopened!.client
        this.current = reopened!.candidate
        this.hooks.emit({
          status: 'connected',
          transport: reopened!.candidate.transport,
          debugTransport: this.debugCandidate?.transport ?? reopened!.candidate.transport,
          descriptor: reopened!.candidate.descriptor,
        })
        return
      case 'give-up':
        return this.declareLost(previous)
      default:
        return
    }
  }

  /** Try every candidate once; return the first that opens and answers. */
  private async reopen(): Promise<{ client: DeviceModbusTransport; candidate: DeviceLinkCandidate } | null> {
    for (const candidate of this.candidates) {
      if (candidate.transport === 'rtu' && !(await this.hooks.serialPortPresent(candidate.descriptor))) continue

      let client: DeviceModbusTransport
      try {
        client = candidate.create()
      } catch {
        continue
      }
      try {
        await client.connect()
        if (await this.hooks.probe(client)) return { client, candidate }
      } catch {
        // Still out, or open but silent — fall through and close it.
      }
      client.disconnect()
    }
    return null
  }

  private declareLost(candidate: DeviceLinkCandidate): void {
    const { transport, descriptor } = candidate
    this.trace(`LOST: ${transport} ${descriptor} could not be recovered`)
    this.close({ silent: true })
    this.hooks.emit({ status: 'error', transport, descriptor, reason: 'lost' })
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
