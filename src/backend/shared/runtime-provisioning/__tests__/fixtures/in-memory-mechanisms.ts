import type { UsersInfoRawFacts } from '../../../../../middleware/shared/ports/runtime-port'
import type {
  HostKeyFileReadResult,
  RuntimeProvisioningMechanisms,
  SshAuthChoice,
  SshBannerReadResult,
  SshExecResult,
  SshSession,
  SshSessionOpenRequest,
  SshSessionOpenResult,
} from '../../../../../middleware/shared/ports/runtime-provisioning-mechanisms'
import type {
  RuntimeProvisioningEvent,
  RuntimeProvisioningPort,
} from '../../../../../middleware/shared/ports/runtime-provisioning-port'
import type { DeviceCommand } from '../../commands'
import { buildExec, pollInstallerCommand, PROVISIONING_COMMANDS, startInstallerCommand } from '../../commands'
import { POLL_READ_BYTES } from '../../output'

export const START_TIME = Date.UTC(2026, 10, 5, 12, 0, 0, 0)
export const DEVICE_PASSWORD = 'S3cr3t-Pi!'
export const DEFAULT_INSTALLER_DIR = '/tmp/tmp.Xy7Qa9Zk2B'
export const SSH_GREETING = 'SSH-2.0-OpenSSH_9.2p1 Debian-2+deb12u3\r\n'

export type FixedCommandName =
  | 'probeSystem'
  | 'privilegeCheck'
  | 'inspectRuntime'
  | 'startDockerAndBootloader'
  | 'startBootloader'
  | 'startRuntimeContainer'
  | 'startNativeService'
  | 'prepareInstaller'
  | 'dockerPresent'

export const FIXED_COMMAND_NAMES: readonly FixedCommandName[] = [
  'probeSystem',
  'privilegeCheck',
  'inspectRuntime',
  'startDockerAndBootloader',
  'startBootloader',
  'startRuntimeContainer',
  'startNativeService',
  'prepareInstaller',
  'dockerPresent',
]

export type ScriptedCommandName = FixedCommandName | 'startInstaller'

export type RecordedCommandName = ScriptedCommandName | 'pollInstaller' | 'unrecognized'

export interface ExecReply {
  exitCode?: number | null
  stdout?: string
  stderr?: string
  rejectWith?: string
}

export interface ExecContext {
  stdin: string | undefined
  index: number
}

export type ExecHandler = (context: ExecContext) => ExecReply | Promise<ExecReply>

export interface InstallerPollReply {
  exit: 'running' | number
  text?: string
  from?: number
  size?: number
  raw?: string
}

export interface PollContext {
  index: number
  offset: number
}

export type PollHandler = (context: PollContext) => InstallerPollReply | Promise<InstallerPollReply>

export interface ReachabilityContext {
  now: number
  waitingSince: number | null
  index: number
}

export type ReachabilityHandler = (context: ReachabilityContext) => UsersInfoRawFacts

export interface FakeDeviceOptions {
  banner?: SshBannerReadResult
  presentedKey?: string
  sshReachable?: boolean
  failAfterHostKey?: boolean
  failure?: { level?: string; code?: string; message: string }
  authMethods?: string[]
  devicePassword?: string
  sudoAllowed?: boolean
  hostKeyFile?: HostKeyFileReadResult
  replaceFails?: boolean
  system?: string
  runtime?: string
  installerDir?: string
  commands?: Partial<Record<ScriptedCommandName, ExecReply | ExecHandler>>
  polls?: InstallerPollReply[] | PollHandler
  runtimeAnswersAfterMs?: number | null
  reachability?: ReachabilityHandler
  onOpen?: () => void
}

export type DeviceCall =
  | { kind: 'banner-read'; host: string; port: number; timeoutMs: number; maxBytes: number }
  | { kind: 'host-key-read' }
  | { kind: 'host-key-replace'; text: string; saved: boolean }
  | { kind: 'open'; host: string; port: number; username: string; password: string; timeoutMs: number }
  | { kind: 'host-key-check'; key: string; accepted: boolean }
  | { kind: 'auth'; method: 'none' | 'password'; password: string | null }
  | { kind: 'auth-stop' }
  | {
      kind: 'exec'
      name: RecordedCommandName
      command: string
      stdin: string | undefined
      sudo: boolean
      at: number
    }
  | { kind: 'close' }
  | { kind: 'drop' }
  | { kind: 'sleep'; ms: number; at: number }
  | { kind: 'check'; host: string; at: number; answered: boolean }
  | { kind: 'audit'; line: string }
  | { kind: 'event'; event: RuntimeProvisioningEvent; at: number }

export type ExecCall = Extract<DeviceCall, { kind: 'exec' }>
export type AuthCall = Extract<DeviceCall, { kind: 'auth' }>
export type CheckCall = Extract<DeviceCall, { kind: 'check' }>
export type SleepCall = Extract<DeviceCall, { kind: 'sleep' }>

export interface FakeClock {
  current(): number
  nowCalls(): number
  pendingSleeps(): number
  hold(): void
  nextSleep(): Promise<void>
}

export interface FakeDevice {
  mechanisms: RuntimeProvisioningMechanisms
  log: DeviceCall[]
  clock: FakeClock
  watch(port: RuntimeProvisioningPort): void
  hostKeyFile(): HostKeyFileReadResult
  dropConnection(): void
  sessionClosed(): boolean
  closedListeners(): number
  waitingSince(): number | null
}

export interface SystemFactsInput {
  os?: string
  systemd?: boolean
  dpkgArch?: string
  machine?: string
  longBit?: string
  uid?: string
}

export function systemOutput(input: SystemFactsInput = {}): string {
  const facts = {
    os: 'Linux',
    systemd: true,
    dpkgArch: 'arm64',
    machine: 'aarch64',
    longBit: '64',
    uid: '1000',
    ...input,
  }
  return [
    `os=${facts.os}`,
    `systemd=${facts.systemd ? 'yes' : 'no'}`,
    `dpkg_arch=${facts.dpkgArch}`,
    `machine=${facts.machine}`,
    `long_bit=${facts.longBit}`,
    `uid=${facts.uid}`,
    '',
  ].join('\n')
}

export interface RuntimeFactsInput {
  docker?: 'active' | 'inactive' | 'absent'
  bootloader?: 'running' | 'stopped' | 'absent'
  runtimeContainer?: 'running' | 'stopped' | 'absent'
  native?: 'active' | 'inactive' | 'absent'
  v3?: string[]
}

export function runtimeOutput(input: RuntimeFactsInput = {}): string {
  const v3 = input.v3 ?? []
  return [
    `docker=${input.docker ?? 'absent'}`,
    `bootloader=${input.bootloader ?? 'absent'}`,
    `runtime_container=${input.runtimeContainer ?? 'absent'}`,
    `native=${input.native ?? 'absent'}`,
    `v3=${v3.length === 0 ? 'none' : v3.join(',')}`,
    '',
  ].join('\n')
}

function sshString(bytes: number[]): number[] {
  const length = bytes.length
  return [(length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff, ...bytes]
}

export function hostKeyBlob(keyType: string, fill: number): string {
  const typeBytes = Array.from(keyType, (character) => character.charCodeAt(0))
  const keyBytes = Array.from({ length: 32 }, () => fill)
  return btoa(String.fromCharCode(...sshString(typeBytes), ...sshString(keyBytes)))
}

export function hostKeyFileText(entries: { host: string; port: number; keyType: string; key: string }[]): string {
  const hosts = entries.map((entry) => ({ ...entry, firstSeen: '2026-10-01T08:30:00.000Z' }))
  return `${JSON.stringify({ version: 1, hosts }, null, 2)}\n`
}

export const ED25519_AAAA = hostKeyBlob('ssh-ed25519', 0xaa)
export const ED25519_BBBB = hostKeyBlob('ssh-ed25519', 0xbb)
export const ED25519_CCCC = hostKeyBlob('ssh-ed25519', 0xcc)
export const ECDSA_AAAA = hostKeyBlob('ecdsa-sha2-nistp256', 0xaa)

export const RUNTIME_ANSWERED: UsersInfoRawFacts = { kind: 'response', statusCode: 404, body: '' }
export const RUNTIME_REFUSED: UsersInfoRawFacts = {
  kind: 'error',
  code: 'ECONNREFUSED',
  message: 'connect ECONNREFUSED 192.168.1.50:8443',
  timedOut: false,
}

const NEUTRAL_FAILURE = { message: 'connection closed' }
const MAX_AUTH_ROUNDS = 6
const SLEEP_LIMIT = 1_000

function abortError(): Error {
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

function execResult(reply: ExecReply): SshExecResult {
  return {
    exitCode: reply.exitCode === undefined ? 0 : reply.exitCode,
    stdout: reply.stdout ?? '',
    stderr: reply.stderr ?? '',
    truncated: false,
  }
}

function pollStdout(reply: InstallerPollReply, from: number): string {
  const text = reply.text ?? ''
  const size = reply.size ?? from + text.length
  return `exit=${reply.exit}\nsize=${size}\nfrom=${from}\n---\n${text}`
}

interface Recognized {
  name: RecordedCommandName
  sudo: boolean
}

interface PendingExec {
  reject: (error: Error) => void
}

interface SessionState {
  closed: boolean
  listeners: (() => void)[]
  pending: PendingExec[]
}

export function createFakeDevice(options: FakeDeviceOptions = {}): FakeDevice {
  const log: DeviceCall[] = []
  const devicePassword = options.devicePassword ?? DEVICE_PASSWORD
  const installerDir = options.installerDir ?? DEFAULT_INSTALLER_DIR
  const authMethods = options.authMethods ?? ['publickey', 'password']
  const failure: SshSessionOpenResult = { kind: 'error', ...(options.failure ?? NEUTRAL_FAILURE) }
  let fileState: HostKeyFileReadResult = options.hostKeyFile ?? { kind: 'absent' }
  let now = START_TIME
  let nowCalls = 0
  let held = false
  let sleepWaiters: (() => void)[] = []
  let pendingSleeps = 0
  let sleepCount = 0
  let waitingSince: number | null = null
  let sessions: SessionState[] = []
  let execIndex = 0
  let pollIndex = 0
  let pollOffset = 0
  let checkIndex = 0

  const defaults: Record<ScriptedCommandName, ExecReply> = {
    probeSystem: { stdout: options.system ?? systemOutput() },
    privilegeCheck: { exitCode: 0 },
    inspectRuntime: { stdout: options.runtime ?? runtimeOutput() },
    startDockerAndBootloader: { exitCode: 0 },
    startBootloader: { stdout: 'openplc-bootloader\n' },
    startRuntimeContainer: { stdout: 'openplc-runtime\n' },
    startNativeService: { exitCode: 0 },
    prepareInstaller: { stdout: `dir=${installerDir}\ndownload=ok\n` },
    dockerPresent: { stdout: 'docker=no\n' },
    startInstaller: { exitCode: 0 },
  }

  function recognize(command: string): Recognized {
    const candidates: [ScriptedCommandName | 'pollInstaller', DeviceCommand][] = [
      ...FIXED_COMMAND_NAMES.map((name): [FixedCommandName, DeviceCommand] => [name, PROVISIONING_COMMANDS[name]]),
      ['startInstaller', startInstallerCommand(installerDir)],
      ['pollInstaller', pollInstallerCommand(installerDir, pollOffset, POLL_READ_BYTES)],
    ]
    for (const [name, deviceCommand] of candidates) {
      if (buildExec(deviceCommand, 'root').command === command) return { name, sudo: false }
      if (buildExec(deviceCommand, 'sudo').command === command) return { name, sudo: true }
    }
    return { name: 'unrecognized', sudo: false }
  }

  async function scriptedReply(name: ScriptedCommandName, context: ExecContext): Promise<ExecReply> {
    const scripted = options.commands?.[name]
    if (scripted === undefined) return defaults[name]
    return typeof scripted === 'function' ? scripted(context) : scripted
  }

  async function pollReply(): Promise<ExecReply> {
    const index = pollIndex
    pollIndex += 1
    const polls = options.polls ?? [{ exit: 0, text: 'Installing the OpenPLC Runtime\nDone\n' }]
    const reply =
      typeof polls === 'function'
        ? await polls({ index, offset: pollOffset })
        : polls[Math.min(index, polls.length - 1)]
    if (reply.raw !== undefined) return { stdout: reply.raw }
    const from = reply.from ?? pollOffset
    pollOffset = from + (reply.text ?? '').length
    return { stdout: pollStdout(reply, from) }
  }

  async function reply(recognized: Recognized, stdin: string | undefined, index: number): Promise<ExecReply> {
    if (recognized.name === 'unrecognized') return { exitCode: 127, stderr: 'sh: 1: unexpected command\n' }
    if (recognized.sudo && options.sudoAllowed === false) {
      return { exitCode: 1, stderr: 'Sorry, user is not allowed to execute commands as root.\n' }
    }
    if (recognized.sudo && stdin !== `${devicePassword}\n`) {
      return { exitCode: 1, stderr: 'sudo: 1 incorrect password attempt\n' }
    }
    if (recognized.name === 'pollInstaller') return pollReply()
    if (recognized.name === 'startInstaller') {
      pollIndex = 0
      pollOffset = 0
    }
    return scriptedReply(recognized.name, { stdin, index })
  }

  function endSession(state: SessionState): void {
    state.closed = true
    const rejected = state.pending
    state.pending = []
    for (const pending of rejected) pending.reject(new Error('session closed'))
    const listeners = state.listeners
    for (const listener of listeners) listener()
  }

  function createSession(): SshSession {
    const state: SessionState = { closed: false, listeners: [], pending: [] }
    sessions = [...sessions, state]
    return {
      exec(command, execOptions) {
        const index = execIndex
        execIndex += 1
        const recognized = recognize(command)
        log.push({
          kind: 'exec',
          name: recognized.name,
          command,
          stdin: execOptions.stdin,
          sudo: recognized.sudo,
          at: now,
        })
        if (state.closed) return Promise.reject(new Error('Not connected'))
        return new Promise<SshExecResult>((resolve, reject) => {
          const pending: PendingExec = { reject }
          state.pending.push(pending)
          const settle = (): void => {
            state.pending = state.pending.filter((entry) => entry !== pending)
          }
          reply(recognized, execOptions.stdin, index).then(
            (result) => {
              settle()
              if (result.rejectWith !== undefined) reject(new Error(result.rejectWith))
              else resolve(execResult(result))
            },
            (error: unknown) => {
              settle()
              reject(error instanceof Error ? error : new Error('exec failed'))
            },
          )
        })
      },
      close() {
        log.push({ kind: 'close' })
        if (!state.closed) endSession(state)
      },
      onClosed(callback) {
        state.listeners = [...state.listeners, callback]
        return () => {
          state.listeners = state.listeners.filter((listener) => listener !== callback)
        }
      },
    }
  }

  function latestSession(): SessionState | undefined {
    return sessions[sessions.length - 1]
  }

  async function authenticate(request: SshSessionOpenRequest): Promise<SshSessionOpenResult> {
    let methodsLeft: string[] | null = null
    for (let round = 0; round < MAX_AUTH_ROUNDS; round += 1) {
      const choice: SshAuthChoice = request.chooseAuth(methodsLeft)
      if (choice === 'stop') {
        log.push({ kind: 'auth-stop' })
        return failure
      }
      log.push({ kind: 'auth', method: choice, password: choice === 'password' ? request.password : null })
      const accepted = choice === 'password' && authMethods.includes('password') && request.password === devicePassword
      if (accepted) return { kind: 'open', session: createSession() }
      methodsLeft = [...authMethods]
    }
    return failure
  }

  const mechanisms: RuntimeProvisioningMechanisms = {
    bannerProbe: {
      read(request) {
        log.push({ kind: 'banner-read', ...request })
        return Promise.resolve(options.banner ?? { kind: 'data', text: SSH_GREETING })
      },
    },
    sshSession: {
      async open(request) {
        const { host, port, username, password, timeoutMs } = request
        log.push({ kind: 'open', host, port, username, password, timeoutMs })
        options.onOpen?.()
        if (options.sshReachable === false) {
          return { kind: 'error', code: 'ECONNREFUSED', message: `connect ECONNREFUSED ${host}:${port}` }
        }
        const key = options.presentedKey ?? ED25519_AAAA
        const accepted = await request.verifyHostKey(key)
        log.push({ kind: 'host-key-check', key, accepted })
        if (!accepted || options.failAfterHostKey === true) return failure
        return authenticate(request)
      },
    },
    hostKeyFile: {
      read() {
        log.push({ kind: 'host-key-read' })
        return Promise.resolve(fileState)
      },
      replace(text) {
        const saved = options.replaceFails !== true
        log.push({ kind: 'host-key-replace', text, saved })
        if (!saved) return Promise.reject(new Error('EACCES: rename of the temporary file failed'))
        fileState = { kind: 'text', text }
        return Promise.resolve()
      },
    },
    reachability: {
      check(host) {
        const index = checkIndex
        checkIndex += 1
        const context = { now, waitingSince, index }
        const answersAfter = options.runtimeAnswersAfterMs === undefined ? 0 : options.runtimeAnswersAfterMs
        const facts =
          options.reachability !== undefined
            ? options.reachability(context)
            : answersAfter !== null && waitingSince !== null && now >= waitingSince + answersAfter
              ? RUNTIME_ANSWERED
              : RUNTIME_REFUSED
        const answered = facts.kind === 'response' && (facts.statusCode === 200 || facts.statusCode === 404)
        log.push({ kind: 'check', host, at: now, answered })
        return Promise.resolve(facts)
      },
    },
    clock: {
      now() {
        nowCalls += 1
        return now
      },
      sleep(ms, signal) {
        log.push({ kind: 'sleep', ms, at: now })
        sleepCount += 1
        if (sleepCount > SLEEP_LIMIT) return Promise.reject(new Error('fake clock: sleep limit reached'))
        if (signal?.aborted === true) return Promise.reject(abortError())
        if (!held) {
          now += ms
          return Promise.resolve()
        }
        return new Promise<void>((_resolve, reject) => {
          pendingSleeps += 1
          signal?.addEventListener(
            'abort',
            () => {
              pendingSleeps -= 1
              reject(abortError())
            },
            { once: true },
          )
          const waiters = sleepWaiters
          sleepWaiters = []
          for (const waiter of waiters) waiter()
        })
      },
    },
    audit: {
      write(line) {
        log.push({ kind: 'audit', line })
      },
    },
  }

  const clock: FakeClock = {
    current: () => now,
    nowCalls: () => nowCalls,
    pendingSleeps: () => pendingSleeps,
    hold() {
      held = true
    },
    nextSleep() {
      if (pendingSleeps > 0) return Promise.resolve()
      return new Promise<void>((resolve) => {
        sleepWaiters = [...sleepWaiters, resolve]
      })
    },
  }

  return {
    mechanisms,
    log,
    clock,
    watch(port) {
      port.onEvent((event) => {
        log.push({ kind: 'event', event, at: now })
        if (event.type === 'phase' && event.phase === 'waiting-runtime' && waitingSince === null) waitingSince = now
      })
    },
    hostKeyFile: () => fileState,
    dropConnection() {
      log.push({ kind: 'drop' })
      const state = latestSession()
      if (state !== undefined && !state.closed) endSession(state)
    },
    sessionClosed: () => latestSession()?.closed ?? false,
    closedListeners: () => sessions.reduce((total, state) => total + state.listeners.length, 0),
    waitingSince: () => waitingSince,
  }
}

export function execCalls(device: FakeDevice): ExecCall[] {
  return device.log.filter((call): call is ExecCall => call.kind === 'exec')
}

export function commandNames(device: FakeDevice): RecordedCommandName[] {
  return execCalls(device).map((call) => call.name)
}

export function authCalls(device: FakeDevice): AuthCall[] {
  return device.log.filter((call): call is AuthCall => call.kind === 'auth')
}

export function checkCalls(device: FakeDevice): CheckCall[] {
  return device.log.filter((call): call is CheckCall => call.kind === 'check')
}

export function sleepCalls(device: FakeDevice): SleepCall[] {
  return device.log.filter((call): call is SleepCall => call.kind === 'sleep')
}

export function countOf(device: FakeDevice, kind: DeviceCall['kind']): number {
  return device.log.filter((call) => call.kind === kind).length
}

export function events(device: FakeDevice): RuntimeProvisioningEvent[] {
  return device.log.flatMap((call) => (call.kind === 'event' ? [call.event] : []))
}

export function phaseEvents(device: FakeDevice): Extract<RuntimeProvisioningEvent, { type: 'phase' }>[] {
  return events(device).flatMap((event) => (event.type === 'phase' ? [event] : []))
}

export function outputLines(device: FakeDevice): string[] {
  return events(device).flatMap((event) => (event.type === 'output' ? [event.line] : []))
}

export function consoleMessages(device: FakeDevice): string[] {
  return events(device).flatMap((event) => (event.type === 'console' ? [event.message] : []))
}

export function auditEvents(device: FakeDevice): string[] {
  return events(device).flatMap((event) => (event.type === 'audit' ? [event.line] : []))
}

export function auditWrites(device: FakeDevice): string[] {
  return device.log.flatMap((call) => (call.kind === 'audit' ? [call.line] : []))
}

export function mechanismCalls(device: FakeDevice): DeviceCall[] {
  return device.log.filter((call) => call.kind !== 'event')
}
