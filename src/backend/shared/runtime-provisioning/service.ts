import type {
  RuntimeProvisioningMechanisms,
  SshAuthChoice,
  SshBannerReadResult,
  SshExecResult,
  SshSession,
} from '@root/middleware/shared/ports/runtime-provisioning-mechanisms'
import type {
  RuntimeProvisioningEvent,
  RuntimeProvisioningOperation,
  RuntimeProvisioningOutcome,
  RuntimeProvisioningPhase,
  RuntimeProvisioningPort,
  RuntimeProvisioningRunRequest,
  SshProbeFailureReason,
  SshProbeResult,
} from '@root/middleware/shared/ports/runtime-provisioning-port'
import {
  formatProvisioningTarget,
  SshProbeRequestSchema,
  validateRunRequest,
} from '@root/middleware/shared/ports/runtime-provisioning-port'
import type { Unsubscribe } from '@root/middleware/shared/ports/types'
import {
  isSshGreeting,
  SSH_PROBE_MAX_BYTES,
  SSH_PROBE_TIMEOUT_MS,
  usersInfoFromFacts,
} from '@root/middleware/shared/utils/runtime-provisioning'

import type { AuditOperation, AuditOutcome } from './audit'
import { formatAuditLine } from './audit'
import type { Account, DeviceCommand } from './commands'
import { buildExec, pollInstallerCommand, PROVISIONING_COMMANDS, startInstallerCommand } from './commands'
import type { HostKeyFileState } from './host-key-file'
import { decideHostKey, parseHostKeyFile } from './host-key-file'
import type { DeviceClass, RuntimeFacts, SystemFacts } from './inspection'
import { archSupport, classifyRuntime, parseRuntimeFacts, parseSystemFacts, systemSupport } from './inspection'
import { classifyInstallerExit, parseInstallerPoll, parsePrepareInstaller } from './installer'
import { createConsoleBound, createDialogTail, createLinePipeline, POLL_READ_BYTES, scrubPassword } from './output'

export const SSH_SESSION_TIMEOUT_MS = 20_000

export const INSTALLER_POLL_INTERVAL_MS = 1_000

export const RUNTIME_WAIT_MS = 120_000

export const RUNTIME_WAIT_INTERVAL_MS = 2_000

export const INSTALLER_START_POLL_LIMIT = 60

export const INSTALLER_FOLLOW_MAX_MS = 3_600_000

const EXEC_MAX_OUTPUT_BYTES = 2 * POLL_READ_BYTES

export interface RuntimeProvisioningServiceState {
  active: boolean
  target: string | null
  phase: RuntimeProvisioningPhase | null
  operation: 'inspect' | 'start' | 'install' | null
  cancellable: boolean
}

export interface RuntimeProvisioningService extends RuntimeProvisioningPort {
  detach(reason: 'renderer-gone' | 'quit'): void
  inspectState(): RuntimeProvisioningServiceState
}

type StartTarget = Extract<DeviceClass, { kind: 'start' }>['target']

type OpenFailure = 'changed' | 'not-saved' | 'password-not-offered' | 'rejected'

interface Connection {
  session: SshSession
  stopWatching: Unsubscribe
}

interface RunContext {
  host: string
  port: number
  target: string
  credentials: { username: string; password: string }
  startedAt: number
  operation: AuditOperation
  phase: RuntimeProvisioningPhase
  cancellable: boolean
  account: Account
  cancelRequested: boolean
  openFailure: OpenFailure | null
  passwordTried: boolean
  connection: Connection | null
  outcome: RuntimeProvisioningOutcome | null
  stopSleeps: AbortController
  resolve: (outcome: RuntimeProvisioningOutcome) => void
}

const START_COMMANDS: Record<StartTarget, DeviceCommand> = {
  'docker-and-bootloader': PROVISIONING_COMMANDS.startDockerAndBootloader,
  bootloader: PROVISIONING_COMMANDS.startBootloader,
  'runtime-container': PROVISIONING_COMMANDS.startRuntimeContainer,
  'native-service': PROVISIONING_COMMANDS.startNativeService,
}

const IDLE_STATE: RuntimeProvisioningServiceState = {
  active: false,
  target: null,
  phase: null,
  operation: null,
  cancellable: false,
}

function probeFailureReason(result: Extract<SshBannerReadResult, { kind: 'error' }>): SshProbeFailureReason {
  if (result.code === 'ECONNREFUSED') return 'refused'
  return result.timedOut ? 'timeout' : 'unreachable'
}

function auditOutcome(outcome: RuntimeProvisioningOutcome): AuditOutcome {
  switch (outcome.kind) {
    case 'connected-ready':
      return 'success'
    case 'cancelled':
      return 'cancelled'
    case 'unknown':
      return 'unknown'
    default:
      return 'failure'
  }
}

function openFailureOutcome(failure: OpenFailure | null, target: string): RuntimeProvisioningOutcome {
  switch (failure) {
    case 'changed':
      return { kind: 'host-key-changed', target }
    case 'not-saved':
      return { kind: 'host-key-not-saved' }
    case 'password-not-offered':
      return { kind: 'password-auth-not-accepted' }
    case 'rejected':
      return { kind: 'auth-rejected' }
    default:
      return { kind: 'ssh-unreachable' }
  }
}

function stopped(context: RunContext): boolean {
  return context.outcome !== null || context.cancelRequested
}

function chooseAuth(context: RunContext, methodsLeft: string[] | null): SshAuthChoice {
  if (stopped(context)) return 'stop'
  if (methodsLeft === null) return 'none'
  if (context.passwordTried) {
    context.openFailure = 'rejected'
    return 'stop'
  }
  if (!methodsLeft.includes('password')) {
    context.openFailure = 'password-not-offered'
    return 'stop'
  }
  context.passwordTried = true
  return 'password'
}

function checkpoint(context: RunContext): void {
  if (stopped(context)) throw new Error('Runtime provisioning stopped')
}

function release(context: RunContext): void {
  const connection = context.connection
  context.connection = null
  connection?.stopWatching()
  connection?.session.close()
}

function commandOutputLines(result: SshExecResult, password: string): string[] {
  const tail = createDialogTail()
  for (const stream of [result.stdout, result.stderr]) {
    const pipeline = createLinePipeline(password)
    const lines = [...pipeline.push(stream, { startsMidLine: false }), ...pipeline.end()]
    for (const line of lines) tail.push(line)
  }
  return tail.lines()
}

function reportsDocker(result: SshExecResult): boolean {
  return result.stdout.split('\n').includes('docker=yes')
}

export function createRuntimeProvisioningService(
  mechanisms: RuntimeProvisioningMechanisms,
): RuntimeProvisioningService {
  const listeners = new Set<(event: RuntimeProvisioningEvent) => void>()
  let active: RunContext | null = null

  function emit(event: RuntimeProvisioningEvent): void {
    for (const listener of listeners) listener(event)
  }

  function enterPhase(
    context: RunContext,
    phase: RuntimeProvisioningPhase,
    cancellable: boolean,
    operation?: RuntimeProvisioningOperation,
  ): void {
    context.phase = phase
    context.cancellable = cancellable
    emit(
      operation === undefined
        ? { type: 'phase', phase, cancellable }
        : { type: 'phase', phase, cancellable, operation },
    )
  }

  function settle(context: RunContext, outcome: RuntimeProvisioningOutcome): void {
    release(context)
    if (context.outcome !== null) return
    context.outcome = outcome
    context.credentials.username = ''
    context.credentials.password = ''
    context.stopSleeps.abort()
    const line = formatAuditLine({
      host: context.host,
      port: context.port,
      operation: context.operation,
      startedAt: context.startedAt,
      endedAt: mechanisms.clock.now(),
      outcome: auditOutcome(outcome),
    })
    mechanisms.audit.write(line)
    emit({ type: 'audit', line })
    active = null
    context.resolve(outcome)
  }

  function halt(context: RunContext): void {
    settle(context, { kind: 'unknown' })
  }

  async function sleep(context: RunContext, ms: number): Promise<void> {
    await mechanisms.clock.sleep(ms, context.stopSleeps.signal)
    checkpoint(context)
  }

  async function exec(context: RunContext, session: SshSession, command: DeviceCommand): Promise<SshExecResult> {
    const built = buildExec(command, context.account)
    const options = built.sendsPassword
      ? { stdin: `${context.credentials.password}\n`, maxOutputBytes: EXEC_MAX_OUTPUT_BYTES }
      : { maxOutputBytes: EXEC_MAX_OUTPUT_BYTES }
    const result = await session.exec(built.command, options)
    checkpoint(context)
    return result
  }

  async function verifyHostKey(context: RunContext, state: HostKeyFileState, keyBase64: string): Promise<boolean> {
    if (stopped(context)) return false
    const nowIso = new Date(mechanisms.clock.now()).toISOString()
    const decision = decideHostKey(state, { host: context.host, port: context.port }, keyBase64, nowIso)
    if (decision.kind === 'match') return true
    if (decision.kind !== 'first-use') {
      context.openFailure = 'changed'
      return false
    }
    try {
      await mechanisms.hostKeyFile.replace(decision.nextFileText)
      return !stopped(context)
    } catch {
      context.openFailure = 'not-saved'
      return false
    }
  }

  function adopt(context: RunContext, session: SshSession): void {
    context.connection = { session, stopWatching: session.onClosed(() => halt(context)) }
  }

  async function waitForRuntime(
    context: RunContext,
    operation: RuntimeProvisioningOperation | 'none',
    lastLines: string[],
  ): Promise<RuntimeProvisioningOutcome> {
    enterPhase(context, 'waiting-runtime', false)
    const waitStartedAt = mechanisms.clock.now()
    for (;;) {
      const facts = await mechanisms.reachability.check(context.host)
      checkpoint(context)
      if (usersInfoFromFacts(facts).error === undefined) return { kind: 'connected-ready', operation }
      if (mechanisms.clock.now() - waitStartedAt >= RUNTIME_WAIT_MS)
        return { kind: 'not-started', operation, lastLines }
      await sleep(context, RUNTIME_WAIT_INTERVAL_MS)
    }
  }

  async function startRuntime(
    context: RunContext,
    session: SshSession,
    target: StartTarget,
  ): Promise<RuntimeProvisioningOutcome> {
    context.operation = 'start'
    enterPhase(context, 'starting', true, 'start')
    checkpoint(context)
    enterPhase(context, 'starting', false)
    const result = await exec(context, session, START_COMMANDS[target])
    if (result.exitCode !== 0) {
      return {
        kind: 'not-started',
        operation: 'start',
        lastLines: commandOutputLines(result, context.credentials.password),
      }
    }
    return waitForRuntime(context, 'start', [])
  }

  async function followInstaller(
    context: RunContext,
    session: SshSession,
    dir: string,
  ): Promise<RuntimeProvisioningOutcome> {
    const pipeline = createLinePipeline(context.credentials.password)
    const consoleBound = createConsoleBound()
    const tail = createDialogTail()
    const publish = (lines: string[]): void => {
      for (const line of lines) {
        emit({ type: 'output', line })
        tail.push(line)
        for (const message of consoleBound.accept(line)) emit({ type: 'console', level: 'info', message })
      }
    }
    const followStartedAt = mechanisms.clock.now()
    let decoder = new TextDecoder()
    let logStarted = false
    let emptyPolls = 0
    let offset = 0
    for (;;) {
      await sleep(context, INSTALLER_POLL_INTERVAL_MS)
      const result = await exec(context, session, pollInstallerCommand(dir, offset, POLL_READ_BYTES))
      const poll = parseInstallerPoll(result.stdoutBytes)
      if (poll === null) return { kind: 'unknown' }
      const skipped = poll.from > offset
      if (skipped) decoder = new TextDecoder()
      publish(pipeline.push(decoder.decode(poll.body, { stream: true }), { startsMidLine: skipped }))
      offset = Math.max(poll.from, poll.size)
      if (poll.exit === 'running') {
        if (poll.size > 0) logStarted = true
        else if (!logStarted) emptyPolls += 1
        const neverStarted = emptyPolls >= INSTALLER_START_POLL_LIMIT
        if (neverStarted || mechanisms.clock.now() - followStartedAt >= INSTALLER_FOLLOW_MAX_MS)
          return { kind: 'unknown' }
      } else {
        publish(pipeline.push(decoder.decode(), { startsMidLine: false }))
        publish(pipeline.end())
        const verdict = classifyInstallerExit(poll.exit, tail.lines())
        if (verdict === 'ok') return waitForRuntime(context, 'install', tail.lines())
        if (verdict === 'installer-failed') return { kind: 'installer-failed', lastLines: tail.lines() }
        const docker = await exec(context, session, PROVISIONING_COMMANDS.dockerPresent)
        return { kind: 'download-failed', dockerPresent: reportsDocker(docker) }
      }
    }
  }

  async function installRuntime(
    context: RunContext,
    session: SshSession,
    system: SystemFacts,
    runtime: RuntimeFacts,
  ): Promise<RuntimeProvisioningOutcome> {
    const arch = archSupport(system)
    if (!arch.ok) {
      return { kind: 'unsupported', reason: 'arch', detail: scrubPassword(arch.detail, context.credentials.password) }
    }
    context.operation = 'install'
    enterPhase(context, 'installing', true, 'install')
    const prepared = parsePrepareInstaller(
      (await exec(context, session, PROVISIONING_COMMANDS.prepareInstaller)).stdout,
    )
    if (prepared.kind === 'download-failed')
      return { kind: 'download-failed', dockerPresent: runtime.docker !== 'absent' }
    if (prepared.kind === 'invalid') return { kind: 'unknown' }
    enterPhase(context, 'installing', false)
    await exec(context, session, startInstallerCommand(prepared.dir))
    return followInstaller(context, session, prepared.dir)
  }

  async function provisionOnSession(context: RunContext, session: SshSession): Promise<RuntimeProvisioningOutcome> {
    enterPhase(context, 'inspecting', true)
    const system = parseSystemFacts((await exec(context, session, PROVISIONING_COMMANDS.probeSystem)).stdout)
    if (system === null) return { kind: 'unknown' }
    const support = systemSupport(system)
    if (!support.ok) {
      const detail = scrubPassword(support.detail, context.credentials.password)
      return { kind: 'unsupported', reason: support.reason, detail }
    }
    if (system.uid === '0') {
      context.account = 'root'
    } else {
      const privilege = await exec(context, session, PROVISIONING_COMMANDS.privilegeCheck)
      if (privilege.exitCode !== 0) return { kind: 'no-admin-rights' }
    }
    const runtime = parseRuntimeFacts((await exec(context, session, PROVISIONING_COMMANDS.inspectRuntime)).stdout)
    if (runtime === null) return { kind: 'unknown' }
    const deviceClass = classifyRuntime(runtime)
    switch (deviceClass.kind) {
      case 'v3-present':
        return { kind: 'v3-present' }
      case 'already-running':
        return waitForRuntime(context, 'none', [])
      case 'start':
        return startRuntime(context, session, deviceClass.target)
      case 'install':
        return installRuntime(context, session, system, runtime)
    }
  }

  async function provision(context: RunContext): Promise<RuntimeProvisioningOutcome> {
    const fileState = parseHostKeyFile(await mechanisms.hostKeyFile.read())
    checkpoint(context)
    if (fileState.kind === 'unusable') return { kind: 'host-key-file-unusable' }
    const opened = await mechanisms.sshSession.open({
      host: context.host,
      port: context.port,
      username: context.credentials.username,
      password: context.credentials.password,
      timeoutMs: SSH_SESSION_TIMEOUT_MS,
      verifyHostKey: (keyBase64) => verifyHostKey(context, fileState, keyBase64),
      chooseAuth: (methodsLeft) => chooseAuth(context, methodsLeft),
    })
    if (opened.kind === 'open') adopt(context, opened.session)
    checkpoint(context)
    if (opened.kind === 'error') return openFailureOutcome(context.openFailure, context.target)
    return provisionOnSession(context, opened.session)
  }

  function start(request: RuntimeProvisioningRunRequest, resolve: (outcome: RuntimeProvisioningOutcome) => void): void {
    const context: RunContext = {
      host: request.host,
      port: request.port,
      target: formatProvisioningTarget(request.host, request.port),
      credentials: { username: request.username, password: request.password },
      startedAt: mechanisms.clock.now(),
      operation: 'inspect',
      phase: 'connecting',
      cancellable: true,
      account: 'sudo',
      cancelRequested: false,
      openFailure: null,
      passwordTried: false,
      connection: null,
      outcome: null,
      stopSleeps: new AbortController(),
      resolve,
    }
    active = context
    enterPhase(context, 'connecting', true)
    provision(context).then(
      (outcome) => settle(context, outcome),
      () => settle(context, context.cancelRequested ? { kind: 'cancelled' } : { kind: 'unknown' }),
    )
  }

  return {
    async probeSsh(request): Promise<SshProbeResult> {
      const parsed = SshProbeRequestSchema.safeParse(request)
      if (!parsed.success) return { answered: false, reason: 'invalid-input' }
      const result = await mechanisms.bannerProbe.read({
        host: parsed.data.host,
        port: parsed.data.port,
        timeoutMs: SSH_PROBE_TIMEOUT_MS,
        maxBytes: SSH_PROBE_MAX_BYTES,
      })
      if (result.kind === 'error') return { answered: false, reason: probeFailureReason(result) }
      return isSshGreeting(result.text) ? { answered: true } : { answered: false, reason: 'not-ssh' }
    },

    run(input) {
      const validation = validateRunRequest(input)
      if (!validation.ok) return Promise.resolve({ kind: 'invalid-input', field: validation.field })
      if (active !== null) return Promise.resolve({ kind: 'busy' })
      const request = validation.request
      return new Promise<RuntimeProvisioningOutcome>((resolve) => start(request, resolve))
    },

    cancel() {
      const context = active
      if (context !== null && context.cancellable) context.cancelRequested = true
      else if (context !== null) halt(context)
      return Promise.resolve()
    },

    onEvent(callback) {
      listeners.add(callback)
      return listeners.delete.bind(listeners, callback)
    },

    detach() {
      const context = active
      if (context !== null) halt(context)
    },

    inspectState() {
      const context = active
      if (context === null) return { ...IDLE_STATE }
      return {
        active: true,
        target: context.target,
        phase: context.phase,
        operation: context.operation,
        cancellable: context.cancellable,
      }
    },
  }
}
