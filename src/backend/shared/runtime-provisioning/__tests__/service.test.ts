import type {
  HostKeyFileReadResult,
  RuntimeProvisioningMechanisms,
  SshBannerReadResult,
  SshExecResult,
  SshSession,
  SshSessionOpenRequest,
  SshSessionOpenResult,
} from '../../../../middleware/shared/ports/runtime-provisioning-mechanisms'
import type {
  RuntimeProvisioningEvent,
  RuntimeProvisioningOutcome,
  RuntimeProvisioningPhase,
  RuntimeProvisioningRunRequest,
  SshProbeFailureReason,
} from '../../../../middleware/shared/ports/runtime-provisioning-port'
import type { AuditOperation, AuditOutcome } from '../audit'
import { formatAuditLine } from '../audit'
import type { DeviceCommand } from '../commands'
import { buildExec, INSTALLER_DOWNLOAD_MAX_S, PROVISIONING_COMMANDS } from '../commands'
import { parseHostKeyFile } from '../host-key-file'
import * as provisioning from '../index'
import {
  CONSOLE_LINE_LIMIT,
  DIALOG_LINE_LIMIT,
  LINE_CHAR_LIMIT,
  LINE_TRUNCATION_MARKER,
  OUTPUT_TRUNCATED_LINE,
  PASSWORD_MASK,
  POLL_READ_BYTES,
} from '../output'
import { INSTALLER_URL } from '../runtime-names'
import type { RuntimeProvisioningService } from '../service'
import {
  createRuntimeProvisioningService,
  INSTALLER_POLL_INTERVAL_MS,
  PREPARE_INSTALLER_TIMEOUT_MS,
  RUNTIME_WAIT_INTERVAL_MS,
  RUNTIME_WAIT_MS,
  SSH_SESSION_TIMEOUT_MS,
} from '../service'
import type {
  DeviceCall,
  FakeDevice,
  FakeDeviceOptions,
  FixedCommandName,
  InstallerPollReply,
  RecordedCommandName,
  RuntimeFactsInput,
  SystemFactsInput,
} from './fixtures/in-memory-mechanisms'
import {
  auditEvents,
  auditWrites,
  authCalls,
  checkCalls,
  commandNames,
  consoleMessages,
  countOf,
  createFakeDevice,
  DEVICE_PASSWORD,
  ECDSA_AAAA,
  ED25519_AAAA,
  ED25519_BBBB,
  ED25519_CCCC,
  events,
  execCalls,
  hostKeyFileText,
  mechanismCalls,
  outputLines,
  phaseEvents,
  RUNTIME_ANSWERED,
  runtimeOutput,
  sleepCalls,
  START_TIME,
  systemOutput,
  utf8Bytes,
} from './fixtures/in-memory-mechanisms'

const HOST = '192.168.1.50'
const TARGET = '192.168.1.50:22'
const USERNAME = 'commissioner42'
const PASSWORD = DEVICE_PASSWORD
const REQUEST: RuntimeProvisioningRunRequest = { host: HOST, port: 22, username: USERNAME, password: PASSWORD }
const IDLE_STATE = { active: false, target: null, phase: null, operation: null, cancellable: false }
const STATE_CHANGING: RecordedCommandName[] = [
  'startDockerAndBootloader',
  'startBootloader',
  'restartBootloader',
  'startRuntimeContainer',
  'startNativeService',
  'startInstaller',
  'pollInstaller',
]
const DEFAULT_INSTALLER_LINES = ['Installing the OpenPLC Runtime', 'Done']

interface Harness {
  device: FakeDevice
  service: RuntimeProvisioningService
}

function setup(options: FakeDeviceOptions = {}): Harness {
  const device = createFakeDevice(options)
  const service = createRuntimeProvisioningService(device.mechanisms)
  device.watch(service)
  return { device, service }
}

function namesAfterInspection(device: FakeDevice): RecordedCommandName[] {
  const names = commandNames(device)
  const index = names.indexOf('inspectRuntime')
  return index < 0 ? [] : names.slice(index + 1)
}

function phaseFlags(device: FakeDevice): [RuntimeProvisioningPhase, boolean][] {
  return phaseEvents(device).map((event): [RuntimeProvisioningPhase, boolean] => [event.phase, event.cancellable])
}

function indexOfCall(device: FakeDevice, predicate: (call: DeviceCall) => boolean): number {
  return device.log.findIndex(predicate)
}

function isPhase(phase: RuntimeProvisioningPhase, cancellable: boolean): (call: DeviceCall) => boolean {
  return (call) =>
    call.kind === 'event' &&
    call.event.type === 'phase' &&
    call.event.phase === phase &&
    call.event.cancellable === cancellable
}

function isExec(name: RecordedCommandName): (call: DeviceCall) => boolean {
  return (call) => call.kind === 'exec' && call.name === name
}

function callsAfter(device: FakeDevice, index: number): DeviceCall[] {
  return device.log.slice(index + 1)
}

function expectedAudit(
  device: FakeDevice,
  request: RuntimeProvisioningRunRequest,
  operation: AuditOperation,
  outcome: AuditOutcome,
): string {
  return formatAuditLine({
    host: request.host,
    port: request.port,
    operation,
    startedAt: START_TIME,
    endedAt: device.clock.current(),
    outcome,
  })
}

function chunksOf(text: string, size: number): string[] {
  const chunks: string[] = []
  for (let start = 0; start < text.length; start += size) chunks.push(text.slice(start, start + size))
  return chunks
}

function installerPolls(text: string, chunkSize: number, exit: number): InstallerPollReply[] {
  return [...chunksOf(text, chunkSize).map((chunk): InstallerPollReply => ({ exit: 'running', text: chunk })), { exit }]
}

function truncated(line: string): string {
  return `${line.slice(0, LINE_CHAR_LIMIT)}${LINE_TRUNCATION_MARKER}`
}

function hostKeyFile(host: string, port: number, key: string, keyType = 'ssh-ed25519'): HostKeyFileReadResult {
  return { kind: 'text', text: hostKeyFileText([{ host, port, keyType, key }]) }
}

function lastLinesOf(outcome: RuntimeProvisioningOutcome): string[] {
  return outcome.kind === 'not-started' || outcome.kind === 'installer-failed' ? outcome.lastLines : []
}

function pollCount(device: FakeDevice): number {
  return commandNames(device).filter((name) => name === 'pollInstaller').length
}

async function untilLogged(device: FakeDevice, kind: DeviceCall['kind']): Promise<void> {
  for (let turn = 0; turn < 100 && countOf(device, kind) === 0; turn += 1) await Promise.resolve()
}

const OPEN_FAILED: SshSessionOpenResult = { kind: 'error', message: 'connection closed' }

interface HeldOpen {
  request: SshSessionOpenRequest
  finish(result: SshSessionOpenResult): void
}

interface HeldOpenHarness extends Harness {
  opened: Promise<HeldOpen>
}

function setupHeldOpen(replace?: (text: string) => Promise<void>): HeldOpenHarness {
  const device = createFakeDevice()
  let deliver: (held: HeldOpen) => void = () => undefined
  const opened = new Promise<HeldOpen>((resolve) => {
    deliver = resolve
  })
  const mechanisms: RuntimeProvisioningMechanisms = {
    ...device.mechanisms,
    hostKeyFile: replace === undefined ? device.mechanisms.hostKeyFile : { ...device.mechanisms.hostKeyFile, replace },
    sshSession: {
      open: (request) => new Promise<SshSessionOpenResult>((resolve) => deliver({ request, finish: resolve })),
    },
  }
  const service = createRuntimeProvisioningService(mechanisms)
  device.watch(service)
  return { device, service, opened }
}

const STILL_PENDING = 'still pending'
const SETTLE_TURNS = 10_000

async function settledWithin<T>(promise: Promise<T>): Promise<T | typeof STILL_PENDING> {
  const settled: T[] = []
  void promise.then((value) => {
    settled.push(value)
  })
  for (let turn = 0; turn < SETTLE_TURNS && settled.length === 0; turn += 1) await Promise.resolve()
  return settled.length === 0 ? STILL_PENDING : settled[0]
}

async function untilTrue(condition: () => boolean): Promise<void> {
  for (let turn = 0; turn < SETTLE_TURNS && !condition(); turn += 1) await Promise.resolve()
}

function deadlines(device: FakeDevice): [RecordedCommandName, number][] {
  return execCalls(device).map((call): [RecordedCommandName, number] => [call.name, call.timeoutMs])
}

function runs(command: string, deviceCommand: DeviceCommand): boolean {
  return command === buildExec(deviceCommand, 'root').command || command === buildExec(deviceCommand, 'sudo').command
}

function neverSettlingOn(session: SshSession, deviceCommand: DeviceCommand, reached: () => void): SshSession {
  return {
    exec(command, options) {
      const sent = session.exec(command, options)
      if (!runs(command, deviceCommand)) return sent
      sent.catch(() => undefined)
      reached()
      return new Promise<SshExecResult>(() => undefined)
    },
    close: () => session.close(),
    onClosed: (callback) => session.onClosed(callback),
  }
}

interface StuckHarness extends Harness {
  reached(): boolean
}

function setupStuckOn(name: FixedCommandName): StuckHarness {
  const device = createFakeDevice()
  let reached = false
  let opens = 0
  const mechanisms: RuntimeProvisioningMechanisms = {
    ...device.mechanisms,
    sshSession: {
      async open(request) {
        const opened = await device.mechanisms.sshSession.open(request)
        opens += 1
        if (opened.kind !== 'open' || opens > 1) return opened
        const markReached = (): void => {
          reached = true
        }
        return { kind: 'open', session: neverSettlingOn(opened.session, PROVISIONING_COMMANDS[name], markReached) }
      },
    },
  }
  const service = createRuntimeProvisioningService(mechanisms)
  device.watch(service)
  return { device, service, reached: () => reached }
}

function setupEndingWhileOpening(end: (service: RuntimeProvisioningService) => Promise<void> | void): Harness {
  const device = createFakeDevice()
  const ending: { service: RuntimeProvisioningService | null } = { service: null }
  const mechanisms: RuntimeProvisioningMechanisms = {
    ...device.mechanisms,
    sshSession: {
      async open(request) {
        const opened = await device.mechanisms.sshSession.open(request)
        if (ending.service !== null) await end(ending.service)
        return opened
      },
    },
  }
  const service = createRuntimeProvisioningService(mechanisms)
  ending.service = service
  device.watch(service)
  return { device, service }
}

describe('runtime provisioning service exports', () => {
  it('pins the SSH session timeout, the poll interval and the runtime wait', () => {
    expect(SSH_SESSION_TIMEOUT_MS).toBe(20_000)
    expect(INSTALLER_POLL_INTERVAL_MS).toBe(1_000)
    expect(RUNTIME_WAIT_MS).toBe(120_000)
    expect(RUNTIME_WAIT_INTERVAL_MS).toBe(2_000)
  })

  it('pins the installer follow bounds: 60 empty polls and 60 minutes (M18)', () => {
    expect(provisioning).toEqual(
      expect.objectContaining({ INSTALLER_START_POLL_LIMIT: 60, INSTALLER_FOLLOW_MAX_MS: 3_600_000 }),
    )
  })

  it('is re-exported from the runtime-provisioning index', () => {
    expect(provisioning).toEqual(
      expect.objectContaining({
        createRuntimeProvisioningService,
        SSH_SESSION_TIMEOUT_MS,
        INSTALLER_POLL_INTERVAL_MS,
        RUNTIME_WAIT_MS,
        RUNTIME_WAIT_INTERVAL_MS,
      }),
    )
  })
})

describe('SSH keepalive and device command deadlines (F22, AC10.3, BR26)', () => {
  const RUNTIME_CONTAINER_STOPPED = runtimeOutput({
    docker: 'active',
    bootloader: 'running',
    runtimeContainer: 'stopped',
  })

  it('pins the keepalive at 5 s x 3 and the command deadlines at 30 s, 150 s for the download and the start', () => {
    expect(provisioning).toEqual(
      expect.objectContaining({
        SSH_KEEPALIVE_INTERVAL_MS: 5_000,
        SSH_KEEPALIVE_COUNT_MAX: 3,
        EXEC_TIMEOUT_MS: 30_000,
        PREPARE_INSTALLER_TIMEOUT_MS: 150_000,
        START_COMMAND_TIMEOUT_MS: 150_000,
      }),
    )
  })

  it("gives the installer download step more time than curl's own limit, so curl gives up first", () => {
    expect(PREPARE_INSTALLER_TIMEOUT_MS).toBeGreaterThan(INSTALLER_DOWNLOAD_MAX_S * 1000)
  })

  it('opens the SSH session with a keepalive every 5 s, given up after 3 unanswered', async () => {
    const { device, service } = setup()

    await service.run(REQUEST)

    expect(device.log.filter((call) => call.kind === 'open')).toEqual([
      expect.objectContaining({ timeoutMs: SSH_SESSION_TIMEOUT_MS, keepaliveIntervalMs: 5_000, keepaliveCountMax: 3 }),
    ])
  })

  it('gives the download step 150 s and every other install command 30 s, up to the Docker check', async () => {
    const { device, service } = setup({
      runtime: runtimeOutput({ docker: 'absent' }),
      polls: [
        { exit: 'running', text: 'Installing\n' },
        { exit: 'running', text: '[ERROR] Could not download the Docker installer.\n' },
        { exit: 1 },
      ],
      commands: { dockerPresent: { stdout: 'docker=no\n' } },
    })

    await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'download-failed', dockerPresent: false })
    expect(deadlines(device)).toEqual([
      ['probeSystem', 30_000],
      ['privilegeCheck', 30_000],
      ['inspectRuntime', 30_000],
      ['prepareInstaller', 150_000],
      ['startInstaller', 30_000],
      ['pollInstaller', 30_000],
      ['pollInstaller', 30_000],
      ['pollInstaller', 30_000],
      ['dockerPresent', 30_000],
    ])
  })

  it('gives every poll of a followed installer 30 s', async () => {
    const { device, service } = setup({
      polls: [
        { exit: 'running', text: 'one\n' },
        { exit: 'running', text: 'two\n' },
        { exit: 'running', text: 'three\n' },
        { exit: 0, text: 'Done\n' },
      ],
    })

    await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'connected-ready', operation: 'install' })
    const polls = deadlines(device).filter(([name]) => name === 'pollInstaller')
    expect(polls).toEqual([
      ['pollInstaller', 30_000],
      ['pollInstaller', 30_000],
      ['pollInstaller', 30_000],
      ['pollInstaller', 30_000],
    ])
  })

  it.each([
    ['startRuntimeContainer', { docker: 'active', bootloader: 'running', runtimeContainer: 'stopped' }],
    ['startDockerAndBootloader', { docker: 'inactive', bootloader: 'stopped', runtimeContainer: 'stopped' }],
    ['startBootloader', { docker: 'active', bootloader: 'stopped', runtimeContainer: 'stopped' }],
    ['restartBootloader', { docker: 'active', bootloader: 'running', runtimeContainer: 'absent' }],
    ['startNativeService', { native: 'inactive' }],
  ] satisfies [RecordedCommandName, RuntimeFactsInput][])(
    'gives the start command %s 150 s and the inspection commands 30 s (TC32)',
    async (started, facts) => {
      const { device, service } = setup({ runtime: runtimeOutput(facts) })

      await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'connected-ready', operation: 'start' })
      expect(deadlines(device)).toEqual([
        ['probeSystem', 30_000],
        ['privilegeCheck', 30_000],
        ['inspectRuntime', 30_000],
        [started, 150_000],
      ])
    },
  )

  it('ends unknown with no wait when the start command passes its deadline (P7)', async () => {
    const { device, service } = setup({
      runtime: RUNTIME_CONTAINER_STOPPED,
      commands: { startRuntimeContainer: { rejectWith: 'SSH command timed out after 150000 ms' } },
    })

    await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'unknown' })
    expect(checkCalls(device)).toEqual([])
    expect(auditWrites(device)).toEqual([expectedAudit(device, REQUEST, 'start', 'unknown')])
    expect(device.sessionClosed()).toBe(true)
  })

  it('ends unknown, never start-failed, when the channel drops while the start command runs (AS-19)', async () => {
    const harness: Harness = setup({
      runtime: RUNTIME_CONTAINER_STOPPED,
      commands: {
        startRuntimeContainer: () => {
          harness.device.dropConnection()
          return { exitCode: null }
        },
      },
    })

    await expect(harness.service.run(REQUEST)).resolves.toEqual({ kind: 'unknown' })
    expect(checkCalls(harness.device)).toEqual([])
    expect(auditWrites(harness.device)).toEqual([expectedAudit(harness.device, REQUEST, 'start', 'unknown')])
    expect(harness.device.sessionClosed()).toBe(true)
  })
})

describe('probeSsh', () => {
  it('reports an SSH greeting as answered, reading at most 1,024 bytes for 2 s and nothing else (AS-16)', async () => {
    const { device, service } = setup()

    await expect(service.probeSsh({ host: HOST, port: 22 })).resolves.toEqual({ answered: true })
    expect(mechanismCalls(device)).toEqual([
      { kind: 'banner-read', host: HOST, port: 22, timeoutMs: 2000, maxBytes: 1024 },
    ])
  })

  const failures: [string, SshBannerReadResult, SshProbeFailureReason][] = [
    ['data that is not an SSH greeting', { kind: 'data', text: 'HTTP/1.1 400 Bad Request\r\n' }, 'not-ssh'],
    ['no data at all', { kind: 'data', text: '' }, 'not-ssh'],
    ['a refused connection', { kind: 'error', code: 'ECONNREFUSED', timedOut: false }, 'refused'],
    ['a timeout', { kind: 'error', code: 'ETIMEDOUT', timedOut: true }, 'timeout'],
    ['an unreachable host', { kind: 'error', code: 'EHOSTUNREACH', timedOut: false }, 'unreachable'],
    ['an error without a code', { kind: 'error', timedOut: false }, 'unreachable'],
  ]

  it.each(failures)('reports %s as not answered', async (_, banner, reason) => {
    const { device, service } = setup({ banner })

    await expect(service.probeSsh({ host: HOST, port: 2222 })).resolves.toEqual({ answered: false, reason })
    expect(mechanismCalls(device).map((call) => call.kind)).toEqual(['banner-read'])
  })

  it.each([
    ['an invalid host', { host: 'not a host!', port: 22 }],
    ['port 0', { host: HOST, port: 0 }],
    ['port 65536', { host: HOST, port: 65536 }],
  ])('refuses %s without touching the network', async (_, request) => {
    const { device, service } = setup()

    await expect(service.probeSsh(request)).resolves.toEqual({ answered: false, reason: 'invalid-input' })
    expect(device.log).toEqual([])
  })
})

describe('run: request validation and one operation at a time', () => {
  it.each([
    ['host', { ...REQUEST, host: 'not a host!' }],
    ['port', { ...REQUEST, port: 0 }],
    ['username', { ...REQUEST, username: '' }],
    ['password', { ...REQUEST, password: '' }],
  ])('refuses an invalid %s with no mechanism call, no event and no audit', async (field, request) => {
    const { device, service } = setup()

    await expect(service.run(request)).resolves.toEqual({ kind: 'invalid-input', field })
    expect(device.log).toEqual([])
    expect(device.clock.nowCalls()).toBe(0)
    expect(service.inspectState()).toEqual(IDLE_STATE)
  })

  it('refuses a request that names an operation, so only the inspection decides it (M11)', async () => {
    const { device, service } = setup()
    const withOperation = { ...REQUEST, operation: 'install' }

    await expect(service.run(withOperation)).resolves.toEqual({ kind: 'invalid-input', field: 'payload' })
    expect(device.log).toEqual([])
  })

  it('answers busy to a second run, for the same or another host, with no second session (M18, AS-13a)', async () => {
    const second: Promise<RuntimeProvisioningOutcome>[] = []
    const harness: Harness = setup({
      commands: {
        probeSystem: () => {
          if (second.length === 0) {
            second.push(harness.service.run(REQUEST), harness.service.run({ ...REQUEST, host: '192.0.2.10' }))
          }
          return { stdout: systemOutput() }
        },
      },
    })

    const first = await harness.service.run(REQUEST)

    await expect(Promise.all(second)).resolves.toEqual([{ kind: 'busy' }, { kind: 'busy' }])
    expect(first).toEqual({ kind: 'connected-ready', operation: 'install' })
    expect(countOf(harness.device, 'open')).toBe(1)
    expect(countOf(harness.device, 'host-key-read')).toBe(1)
    expect(auditWrites(harness.device)).toHaveLength(1)
  })

  it('accepts a new run once the previous one ended', async () => {
    const { device, service } = setup()

    await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'connected-ready', operation: 'install' })
    await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'connected-ready', operation: 'install' })
    expect(countOf(device, 'open')).toBe(2)
    expect(auditWrites(device)).toHaveLength(2)
  })
})

describe('host keys', () => {
  it('trusts the first key on port 22, saving it before any authentication (TC25, TC53 absent, AS-03)', async () => {
    const { device, service } = setup()

    await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'connected-ready', operation: 'install' })

    expect(device.log.filter((call) => call.kind === 'open')).toEqual([
      {
        kind: 'open',
        host: HOST,
        port: 22,
        username: USERNAME,
        password: PASSWORD,
        timeoutMs: SSH_SESSION_TIMEOUT_MS,
        keepaliveIntervalMs: 5_000,
        keepaliveCountMax: 3,
      },
    ])
    const saved = parseHostKeyFile(device.hostKeyFile())
    expect(saved.kind === 'valid' ? saved.entries : []).toEqual([
      expect.objectContaining({ host: HOST, port: 22, keyType: 'ssh-ed25519', key: ED25519_AAAA }),
    ])
    const replaced = indexOfCall(device, (call) => call.kind === 'host-key-replace')
    expect(replaced).toBeGreaterThan(indexOfCall(device, (call) => call.kind === 'host-key-read'))
    expect(replaced).toBeLessThan(indexOfCall(device, (call) => call.kind === 'auth'))
  })

  it('proceeds with the same remembered key and rewrites nothing (TC28)', async () => {
    const file = hostKeyFile(HOST, 22, ED25519_AAAA)
    const { device, service } = setup({ hostKeyFile: file, presentedKey: ED25519_AAAA })

    await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'connected-ready', operation: 'install' })
    expect(countOf(device, 'host-key-replace')).toBe(0)
    expect(device.hostKeyFile()).toEqual(file)
  })

  it.each([
    ['a different key of the same type (TC26)', HOST, ED25519_BBBB, TARGET],
    ['a different key for 192.0.2.10:22 (AS-01)', '192.0.2.10', ED25519_BBBB, '192.0.2.10:22'],
    ['an ECDSA key where an Ed25519 key is remembered (AS-02)', '192.0.2.10', ECDSA_AAAA, '192.0.2.10:22'],
    ['a different key for an IPv6 host', 'fe80::1', ED25519_BBBB, '[fe80::1]:22'],
  ])('stops on %s before any authentication, naming the target', async (_, host, presentedKey, target) => {
    const file = hostKeyFile(host, 22, ED25519_AAAA)
    const { device, service } = setup({ hostKeyFile: file, presentedKey })
    const request = { ...REQUEST, host }

    await expect(service.run(request)).resolves.toEqual({ kind: 'host-key-changed', target })
    expect(authCalls(device)).toEqual([])
    expect(countOf(device, 'host-key-replace')).toBe(0)
    expect(execCalls(device)).toEqual([])
    expect(device.hostKeyFile()).toEqual(file)
    expect(auditWrites(device)).toEqual([expectedAudit(device, request, 'inspect', 'failure')])
  })

  it('remembers keys per host and port, keeping the port 22 entry (TC27)', async () => {
    const { device, service } = setup({ hostKeyFile: hostKeyFile(HOST, 22, ED25519_AAAA), presentedKey: ED25519_CCCC })

    await expect(service.run({ ...REQUEST, port: 2222 })).resolves.toEqual({
      kind: 'connected-ready',
      operation: 'install',
    })
    expect(device.log.filter((call) => call.kind === 'open')).toEqual([
      expect.objectContaining({ host: HOST, port: 2222 }),
    ])
    const saved = parseHostKeyFile(device.hostKeyFile())
    const entries = saved.kind === 'valid' ? saved.entries : []
    expect(entries).toHaveLength(2)
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ host: HOST, port: 22, key: ED25519_AAAA }),
        expect.objectContaining({ host: HOST, port: 2222, key: ED25519_CCCC }),
      ]),
    )
  })

  const unusableFiles: [string, HostKeyFileReadResult][] = [
    ['0 bytes long', { kind: 'text', text: '' }],
    ['not valid content', { kind: 'text', text: 'not json' }],
    [
      'unparsable with the same key the device presents',
      { kind: 'text', text: JSON.stringify({ version: 2, hosts: [{ host: HOST, port: 22, key: ED25519_AAAA }] }) },
    ],
    ['not readable by the editor', { kind: 'error', message: 'EACCES: permission denied' }],
  ]

  it.each(unusableFiles)(
    'stops on a host-key file that is %s, with no SSH connection (TC53, AS-03)',
    async (_, file) => {
      const { device, service } = setup({ hostKeyFile: file })

      await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'host-key-file-unusable' })
      expect(countOf(device, 'open')).toBe(0)
      expect(countOf(device, 'host-key-replace')).toBe(0)
      expect(auditWrites(device)).toEqual([expectedAudit(device, REQUEST, 'inspect', 'failure')])
    },
  )

  it.each([
    ['a valid file without the target', hostKeyFile('10.0.0.7', 22, ED25519_BBBB)],
    ['no file', { kind: 'absent' }],
  ] satisfies [string, HostKeyFileReadResult][])(
    'stops before login when the first-use key cannot be saved, with %s (TC53)',
    async (_, file) => {
      const { device, service } = setup({ hostKeyFile: file, replaceFails: true })

      await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'host-key-not-saved' })
      expect(countOf(device, 'host-key-replace')).toBe(1)
      expect(authCalls(device)).toEqual([])
      expect(execCalls(device)).toEqual([])
      expect(device.hostKeyFile()).toEqual(file)
    },
  )

  it('reads the old file again after a failed save, so a changed key still stops (AS-18)', async () => {
    const file = hostKeyFile('192.0.2.10', 22, ED25519_AAAA)
    const { device, service } = setup({ hostKeyFile: file, presentedKey: ED25519_BBBB, replaceFails: true })

    await expect(service.run({ ...REQUEST, host: '192.0.2.20' })).resolves.toEqual({ kind: 'host-key-not-saved' })
    await expect(service.run({ ...REQUEST, host: '192.0.2.10' })).resolves.toEqual({
      kind: 'host-key-changed',
      target: '192.0.2.10:22',
    })
    expect(countOf(device, 'host-key-read')).toBe(2)
    expect(authCalls(device)).toEqual([])
  })
})

describe('authentication', () => {
  it('tries no authentication first, then the password once, through open only (P6)', async () => {
    const { device, service } = setup()

    await service.run(REQUEST)

    expect(authCalls(device)).toEqual([
      { kind: 'auth', method: 'none', password: null },
      { kind: 'auth', method: 'password', password: PASSWORD },
    ])
  })

  it('reports a server that does not offer password login, never sending the password (TC57)', async () => {
    const { device, service } = setup({ authMethods: ['publickey'] })

    await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'password-auth-not-accepted' })
    expect(authCalls(device)).toEqual([{ kind: 'auth', method: 'none', password: null }])
    expect(execCalls(device)).toEqual([])
    expect(auditWrites(device)).toEqual([expectedAudit(device, REQUEST, 'inspect', 'failure')])
  })

  it('reports a rejected password after one attempt, then reaches the inspection with the right one (TC30)', async () => {
    const { device, service } = setup()

    await expect(service.run({ ...REQUEST, password: 'wrong-pass' })).resolves.toEqual({ kind: 'auth-rejected' })
    expect(authCalls(device).filter((call) => call.method === 'password')).toEqual([
      { kind: 'auth', method: 'password', password: 'wrong-pass' },
    ])
    expect(execCalls(device)).toEqual([])

    await service.run(REQUEST)

    expect(countOf(device, 'open')).toBe(2)
    expect(commandNames(device)[0]).toBe('probeSystem')
  })

  it.each([
    ['the port refuses the connection', { sshReachable: false }],
    ['the connection drops after the host key', { failAfterHostKey: true }],
    [
      'the connection fails with an authentication-looking error before any auth choice',
      {
        failAfterHostKey: true,
        failure: { level: 'client-authentication', message: 'All configured authentication methods failed' },
      },
    ],
  ] satisfies [string, FakeDeviceOptions][])('reports ssh-unreachable when %s', async (_, options) => {
    const { device, service } = setup(options)

    await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'ssh-unreachable' })
    expect(authCalls(device)).toEqual([])
    expect(execCalls(device)).toEqual([])
    expect(countOf(device, 'open')).toBe(1)
  })
})

describe('inspection and privileges', () => {
  it('ends unknown when the system probe output cannot be read (P7)', async () => {
    const { device, service } = setup({ system: 'garbage\n' })

    await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'unknown' })
    expect(commandNames(device)).toEqual(['probeSystem'])
  })

  it.each([
    ['Linux with systemd, amd64 userland', { dpkgArch: 'amd64', machine: 'x86_64' }],
    ['Linux with systemd, arm64 userland', { dpkgArch: 'arm64', machine: 'aarch64' }],
    ['an armhf userland on an ARMv7 CPU', { dpkgArch: 'armhf', machine: 'armv7l', longBit: '32' }],
    ['Raspberry Pi OS 32-bit on a Pi 4', { dpkgArch: 'armhf', machine: 'aarch64', longBit: '32' }],
  ] satisfies [string, SystemFactsInput][])('installs on %s (TC37)', async (_, facts) => {
    const { device, service } = setup({ system: systemOutput(facts) })

    await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'connected-ready', operation: 'install' })
    expect(namesAfterInspection(device)[0]).toBe('prepareInstaller')
  })

  it.each([
    ['an armhf userland on ARMv6', { dpkgArch: 'armhf', machine: 'armv6l', longBit: '32' }, /armhf|armv6l/],
    ['an i686 userland', { dpkgArch: 'i386', machine: 'i686', longBit: '32' }, /i386|i686/],
  ] satisfies [string, SystemFactsInput, RegExp][])(
    'refuses %s before installing, naming the architecture (TC37)',
    async (_, facts, named) => {
      const { device, service } = setup({ system: systemOutput(facts) })

      const outcome = await service.run(REQUEST)

      expect(outcome).toEqual({ kind: 'unsupported', reason: 'arch', detail: expect.stringMatching(named) })
      expect(commandNames(device)).toEqual(['probeSystem', 'privilegeCheck', 'inspectRuntime'])
    },
  )

  it('refuses Linux without systemd for its init system, right after the probe (TC37)', async () => {
    const { device, service } = setup({ system: systemOutput({ systemd: false }) })

    await expect(service.run(REQUEST)).resolves.toEqual(
      expect.objectContaining({ kind: 'unsupported', reason: 'init' }),
    )
    expect(commandNames(device)).toEqual(['probeSystem'])
  })

  it('refuses FreeBSD and names it, right after the probe (TC37)', async () => {
    const { device, service } = setup({
      system: systemOutput({ os: 'FreeBSD', systemd: false, dpkgArch: '', machine: 'amd64' }),
    })

    await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'unsupported', reason: 'os', detail: 'FreeBSD' })
    expect(commandNames(device)).toEqual(['probeSystem'])
  })

  it('scrubs the password from the unsupported detail', async () => {
    const { service } = setup({ system: systemOutput({ os: `x${PASSWORD}`, systemd: false }) })

    const outcome = await service.run(REQUEST)

    expect(outcome).toEqual(expect.objectContaining({ kind: 'unsupported', reason: 'os' }))
    expect(JSON.stringify(outcome)).not.toContain(PASSWORD)
  })

  it('starts an installed runtime on an architecture it would not install on', async () => {
    const { device, service } = setup({
      system: systemOutput({ dpkgArch: 'armhf', machine: 'armv6l', longBit: '32' }),
      runtime: runtimeOutput({ native: 'inactive' }),
    })

    await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'connected-ready', operation: 'start' })
    expect(namesAfterInspection(device)).toEqual(['startNativeService'])
  })

  it('runs every command directly as root, with no privilege check and no password on stdin (TC31 root, M21)', async () => {
    const { device, service } = setup({ system: systemOutput({ uid: '0' }) })

    await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'connected-ready', operation: 'install' })
    expect(commandNames(device)).toEqual([
      'probeSystem',
      'inspectRuntime',
      'prepareInstaller',
      'startInstaller',
      'pollInstaller',
    ])
    expect(execCalls(device).filter((call) => call.sudo)).toEqual([])
    expect(execCalls(device).filter((call) => (call.stdin ?? '').includes(PASSWORD))).toEqual([])
  })

  it('runs elevated commands through sudo with the password on stdin only (TC31 sudo, M8, M16)', async () => {
    const { device, service } = setup()

    await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'connected-ready', operation: 'install' })
    expect(commandNames(device)).toEqual([
      'probeSystem',
      'privilegeCheck',
      'inspectRuntime',
      'prepareInstaller',
      'startInstaller',
      'pollInstaller',
    ])
    for (const call of execCalls(device)) {
      expect(call.command).not.toContain(PASSWORD)
      if (call.name === 'probeSystem') {
        expect(call.sudo).toBe(false)
        expect(call.stdin ?? '').not.toContain(PASSWORD)
      } else {
        expect(call.sudo).toBe(true)
        expect(call.stdin).toBe(`${PASSWORD}\n`)
      }
    }
  })

  it('stops before any change when the account cannot use sudo (TC31 operator)', async () => {
    const request = { ...REQUEST, username: 'operator' }
    const { device, service } = setup({ sudoAllowed: false })

    await expect(service.run(request)).resolves.toEqual({ kind: 'no-admin-rights' })
    expect(commandNames(device)).toEqual(['probeSystem', 'privilegeCheck'])
    expect(auditWrites(device)).toEqual([expectedAudit(device, request, 'inspect', 'failure')])
  })

  it('ends unknown when the runtime inspection output cannot be read (P7)', async () => {
    const { device, service } = setup({ runtime: 'docker=maybe\n' })

    await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'unknown' })
    expect(namesAfterInspection(device)).toEqual([])
  })

  it.each([
    ['openplc.service and no v4 install', { v3: ['openplc.service'] }],
    ['openplc_v3.service and no v4 install', { v3: ['openplc_v3.service'] }],
    ['openplc-v3.service and no v4 install', { v3: ['openplc-v3.service'] }],
    [
      'openplc.service and a stopped container v4 install',
      { v3: ['openplc.service'], docker: 'inactive', bootloader: 'stopped', runtimeContainer: 'stopped' },
    ],
  ] satisfies [string, RuntimeFactsInput][])(
    'reports v3 present for %s and runs nothing after (TC36)',
    async (_, facts) => {
      const { device, service } = setup({ runtime: runtimeOutput(facts) })

      await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'v3-present' })
      expect(namesAfterInspection(device)).toEqual([])
      expect(checkCalls(device)).toEqual([])
      expect(auditWrites(device)).toEqual([expectedAudit(device, REQUEST, 'inspect', 'failure')])
    },
  )

  it.each([
    ['a running container install', { docker: 'active', bootloader: 'running', runtimeContainer: 'running' }],
    ['a running native service', { native: 'active' }],
  ] satisfies [string, RuntimeFactsInput][])('waits for the runtime with no command for %s (P4)', async (_, facts) => {
    const { device, service } = setup({ runtime: runtimeOutput(facts) })

    await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'connected-ready', operation: 'none' })
    expect(namesAfterInspection(device)).toEqual([])
    expect(phaseFlags(device)).toEqual([
      ['connecting', true],
      ['inspecting', true],
      ['waiting-runtime', false],
    ])
    expect(auditWrites(device)).toEqual([expectedAudit(device, REQUEST, 'inspect', 'success')])
  })

  it('reports not started with no lines when an already running runtime never answers', async () => {
    const { service } = setup({
      runtime: runtimeOutput({ native: 'active' }),
      runtimeAnswersAfterMs: null,
    })

    await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'not-started', operation: 'none', lastLines: [] })
  })
})

describe('start an installed runtime', () => {
  it.each([
    [
      'only the runtime container when the bootloader runs (TC09, AC11.2)',
      { docker: 'active', bootloader: 'running', runtimeContainer: 'stopped' },
      'startRuntimeContainer',
    ],
    [
      'Docker, then the bootloader, when Docker is stopped (TC32)',
      { docker: 'inactive', bootloader: 'stopped', runtimeContainer: 'stopped' },
      'startDockerAndBootloader',
    ],
    [
      'the bootloader when Docker runs and the bootloader is stopped (TC32)',
      { docker: 'active', bootloader: 'stopped', runtimeContainer: 'stopped' },
      'startBootloader',
    ],
    [
      'openplc-runtime.service when the native service is stopped (TC24, TC32)',
      { native: 'inactive' },
      'startNativeService',
    ],
    [
      'the bootloader, by a restart, when the bootloader runs and the runtime container is missing',
      { docker: 'active', bootloader: 'running', runtimeContainer: 'absent' },
      'restartBootloader',
    ],
  ] satisfies [string, RuntimeFactsInput, RecordedCommandName][])(
    'starts %s and nothing else',
    async (_, facts, started) => {
      const { device, service } = setup({ runtime: runtimeOutput(facts) })

      await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'connected-ready', operation: 'start' })
      expect(namesAfterInspection(device)).toEqual([started])
      expect(phaseFlags(device)).toEqual([
        ['connecting', true],
        ['inspecting', true],
        ['starting', true],
        ['starting', false],
        ['waiting-runtime', false],
      ])
      expect(phaseEvents(device)[2]).toEqual(expect.objectContaining({ operation: 'start' }))
      expect(indexOfCall(device, isExec(started))).toBeGreaterThan(indexOfCall(device, isPhase('starting', false)))
      expect(indexOfCall(device, (call) => call.kind === 'check')).toBeGreaterThan(indexOfCall(device, isExec(started)))
    },
  )

  it('reports a failed start command as start-failed with its scrubbed lines, in the console, without waiting (P18)', async () => {
    const { device, service } = setup({
      runtime: runtimeOutput({ docker: 'active', bootloader: 'running', runtimeContainer: 'stopped' }),
      commands: {
        startRuntimeContainer: {
          exitCode: 1,
          stdout: 'starting openplc-runtime\n',
          stderr: `Error response from daemon: No such container: openplc-runtime\nsudo echoed ${PASSWORD}\n`,
        },
      },
    })
    const lastLines = [
      'starting openplc-runtime',
      'Error response from daemon: No such container: openplc-runtime',
      `sudo echoed ${PASSWORD_MASK}`,
    ]

    const outcome = await service.run(REQUEST)

    expect(outcome).toEqual({ kind: 'start-failed', lastLines })
    expect(JSON.stringify(outcome)).not.toContain(PASSWORD)
    expect(checkCalls(device)).toEqual([])
    expect(auditWrites(device)).toEqual([expectedAudit(device, REQUEST, 'start', 'failure')])
  })

  it('sends the lines of a failed start command to the console, in order, before the audit event (AC09.5)', async () => {
    const { device, service } = setup({
      runtime: runtimeOutput({ docker: 'active', bootloader: 'running', runtimeContainer: 'stopped' }),
      commands: {
        startRuntimeContainer: {
          exitCode: 1,
          stdout: 'starting openplc-runtime\n',
          stderr: `Error response from daemon: No such container: openplc-runtime\nsudo echoed ${PASSWORD}\n`,
        },
      },
    })

    await service.run(REQUEST)

    const consoleAndAudit = events(device).filter((event) => event.type === 'console' || event.type === 'audit')
    expect(consoleAndAudit).toEqual([
      { type: 'console', level: 'info', message: 'starting openplc-runtime' },
      { type: 'console', level: 'info', message: 'Error response from daemon: No such container: openplc-runtime' },
      { type: 'console', level: 'info', message: `sudo echoed ${PASSWORD_MASK}` },
      { type: 'audit', line: expectedAudit(device, REQUEST, 'start', 'failure') },
    ])
    expect(JSON.stringify(events(device))).not.toContain(PASSWORD)
  })

  it('reports a start command killed by a signal, exit code null, as start-failed', async () => {
    const { device, service } = setup({
      runtime: runtimeOutput({ native: 'inactive' }),
      commands: { startNativeService: { exitCode: null, stderr: 'Killed\n' } },
    })

    await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'start-failed', lastLines: ['Killed'] })
    expect(consoleMessages(device)).toEqual(['Killed'])
    expect(checkCalls(device)).toEqual([])
  })

  it('bounds the lines of a failed start command to the last 200, each cut at 4,096 characters (M15, M17)', async () => {
    const longLine = `line 203 ${'z'.repeat(LINE_CHAR_LIMIT + 50)}`
    const original = Array.from({ length: 205 }, (_, index) => (index === 202 ? longLine : `line ${index + 1}`))
    const { device, service } = setup({
      runtime: runtimeOutput({ native: 'inactive' }),
      commands: { startNativeService: { exitCode: 1, stdout: `${original.join('\n')}\n` } },
    })

    const outcome = await service.run(REQUEST)
    const expected = [...original.slice(5, 202), truncated(longLine), ...original.slice(203)]

    expect(outcome).toEqual({ kind: 'start-failed', lastLines: expected })
    expect(consoleMessages(device)).toEqual(expected)
  })

  it.each([
    ['answers 119 s later', 119_000, { kind: 'connected-ready', operation: 'start' }],
    ['has not answered 120 s later', null, { kind: 'not-started', operation: 'start', lastLines: [] }],
    ['answers only 125 s later', 125_000, { kind: 'not-started', operation: 'start', lastLines: [] }],
  ] satisfies [string, number | null, RuntimeProvisioningOutcome][])(
    'after a successful start command, when 8443 %s (TC35)',
    async (_, runtimeAnswersAfterMs, expected) => {
      const { service } = setup({
        runtime: runtimeOutput({ docker: 'active', bootloader: 'running', runtimeContainer: 'stopped' }),
        runtimeAnswersAfterMs,
      })

      await expect(service.run(REQUEST)).resolves.toEqual(expected)
    },
  )
})

describe('restart the bootloader when the runtime container is missing', () => {
  const RUNTIME_CONTAINER_MISSING = runtimeOutput({
    docker: 'active',
    bootloader: 'running',
    runtimeContainer: 'absent',
  })

  it('restarts only the bootloader, as administrator with the password on stdin, and connects (start)', async () => {
    const { device, service } = setup({ runtime: RUNTIME_CONTAINER_MISSING })

    await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'connected-ready', operation: 'start' })
    expect(namesAfterInspection(device)).toEqual(['restartBootloader'])
    const restart = execCalls(device).filter((call) => call.name === 'restartBootloader')
    expect(restart).toEqual([
      expect.objectContaining({
        command: buildExec(PROVISIONING_COMMANDS.restartBootloader, 'sudo').command,
        sudo: true,
        stdin: `${PASSWORD}\n`,
      }),
    ])
    expect(auditWrites(device)).toEqual([expectedAudit(device, REQUEST, 'start', 'success')])
  })

  it('never starts the runtime container, another start target or the installer', async () => {
    const { device, service } = setup({ runtime: RUNTIME_CONTAINER_MISSING })

    await service.run(REQUEST)

    const sent = commandNames(device)
    for (const name of [
      'startRuntimeContainer',
      'startBootloader',
      'startDockerAndBootloader',
      'startNativeService',
      'prepareInstaller',
      'startInstaller',
      'pollInstaller',
    ] satisfies RecordedCommandName[]) {
      expect(sent).not.toContain(name)
    }
  })

  it('reports a failed restart as start-failed with its scrubbed lines, in the console before the audit, without waiting', async () => {
    const { device, service } = setup({
      runtime: RUNTIME_CONTAINER_MISSING,
      commands: {
        restartBootloader: {
          exitCode: 1,
          stdout: 'restarting openplc-bootloader\n',
          stderr: `Error response from daemon: Cannot restart container openplc-bootloader\nsudo echoed ${PASSWORD}\n`,
        },
      },
    })
    const lastLines = [
      'restarting openplc-bootloader',
      'Error response from daemon: Cannot restart container openplc-bootloader',
      `sudo echoed ${PASSWORD_MASK}`,
    ]

    const outcome = await service.run(REQUEST)

    expect(outcome).toEqual({ kind: 'start-failed', lastLines })
    expect(JSON.stringify(events(device))).not.toContain(PASSWORD)
    expect(checkCalls(device)).toEqual([])
    expect(events(device).filter((event) => event.type === 'console' || event.type === 'audit')).toEqual([
      ...lastLines.map((message) => ({ type: 'console', level: 'info', message })),
      { type: 'audit', line: expectedAudit(device, REQUEST, 'start', 'failure') },
    ])
  })

  it('reports not started with no lines when 8443 never answers after the restart', async () => {
    const { device, service } = setup({ runtime: RUNTIME_CONTAINER_MISSING, runtimeAnswersAfterMs: null })

    await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'not-started', operation: 'start', lastLines: [] })
    expect(namesAfterInspection(device)).toEqual(['restartBootloader'])
  })

  it('ends unknown with no wait when the restart passes its deadline', async () => {
    const { device, service } = setup({
      runtime: RUNTIME_CONTAINER_MISSING,
      commands: { restartBootloader: { rejectWith: 'SSH command timed out after 150000 ms' } },
    })

    await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'unknown' })
    expect(checkCalls(device)).toEqual([])
    expect(auditWrites(device)).toEqual([expectedAudit(device, REQUEST, 'start', 'unknown')])
  })

  it('ends unknown when cancelled once the restart was sent', async () => {
    let cancelled: Promise<void> = Promise.resolve()
    const harness: Harness = setup({
      runtime: RUNTIME_CONTAINER_MISSING,
      commands: {
        restartBootloader: () => {
          cancelled = harness.service.cancel()
          return { stdout: 'openplc-bootloader\n' }
        },
      },
    })

    await expect(harness.service.run(REQUEST)).resolves.toEqual({ kind: 'unknown' })
    await cancelled
    expect(namesAfterInspection(harness.device)).toEqual(['restartBootloader'])
    expect(checkCalls(harness.device)).toEqual([])
  })
})

describe('waiting for the runtime', () => {
  it('checks the run host every 2 s for 120 s from the start of the wait (M7, BR09)', async () => {
    const { device, service } = setup({ runtimeAnswersAfterMs: null })

    await service.run(REQUEST)

    const waitingSince = device.waitingSince() ?? Number.NaN
    const checks = checkCalls(device)
    expect(checks.every((check) => check.host === HOST)).toBe(true)
    expect(checks[checks.length - 1].at).toBeGreaterThanOrEqual(
      waitingSince + RUNTIME_WAIT_MS - RUNTIME_WAIT_INTERVAL_MS,
    )
    expect(device.clock.current()).toBeLessThanOrEqual(waitingSince + RUNTIME_WAIT_MS + RUNTIME_WAIT_INTERVAL_MS)
    expect(
      sleepCalls(device)
        .filter((sleep) => sleep.at >= waitingSince)
        .map((sleep) => sleep.ms),
    ).toEqual(expect.arrayContaining([RUNTIME_WAIT_INTERVAL_MS]))
    expect(
      sleepCalls(device)
        .filter((sleep) => sleep.at >= waitingSince)
        .every((sleep) => sleep.ms === RUNTIME_WAIT_INTERVAL_MS),
    ).toBe(true)
  })
})

describe('install a missing runtime', () => {
  const INSTALLER_DIR = '/var/tmp/tmp.k3J_9-q'

  it('prepares, starts the installer detached and polls, from the only source (TC33, AS-06, AS-07, AS-11)', async () => {
    const { device, service } = setup({
      installerDir: INSTALLER_DIR,
      polls: [
        { exit: 'running', text: 'Installing\n' },
        { exit: 0, text: 'Done\n' },
      ],
    })

    await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'connected-ready', operation: 'install' })
    expect(namesAfterInspection(device)).toEqual([
      'prepareInstaller',
      'startInstaller',
      'pollInstaller',
      'pollInstaller',
    ])
    const prepare = execCalls(device).find((call) => call.name === 'prepareInstaller')
    expect(prepare?.command).toBe(buildExec(PROVISIONING_COMMANDS.prepareInstaller, 'sudo').command)
    const urls = execCalls(device).flatMap((call) => call.command.match(/[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s'"]*/g) ?? [])
    expect(new Set(urls)).toEqual(new Set([INSTALLER_URL]))
    expect(outputLines(device)).toEqual(['Installing', 'Done'])
  })

  it('offers Cancel until the installer starts, and not after (TC45 flags, AC09.4)', async () => {
    const { device, service } = setup()

    await service.run(REQUEST)

    expect(phaseFlags(device)).toEqual([
      ['connecting', true],
      ['inspecting', true],
      ['installing', true],
      ['installing', false],
      ['waiting-runtime', false],
    ])
    expect(phaseEvents(device)[2]).toEqual(expect.objectContaining({ operation: 'install' }))
    const notCancellable = indexOfCall(device, isPhase('installing', false))
    expect(indexOfCall(device, isExec('prepareInstaller'))).toBeGreaterThan(
      indexOfCall(device, isPhase('installing', true)),
    )
    expect(indexOfCall(device, isExec('prepareInstaller'))).toBeLessThan(notCancellable)
    expect(indexOfCall(device, isExec('startInstaller'))).toBeGreaterThan(notCancellable)
  })

  it('polls every second from the offset after the bytes read, dropping the cut line of a tail read', async () => {
    const { device, service } = setup({
      polls: [
        { exit: 'running', text: 'one\n' },
        { exit: 'running', from: 70_000, text: 'cut line\ntwo\n' },
        { exit: 'running', text: 'three\n' },
        { exit: 0, text: '' },
      ],
    })

    await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'connected-ready', operation: 'install' })
    expect(commandNames(device).filter((name) => name === 'pollInstaller')).toHaveLength(4)
    expect(commandNames(device)).not.toContain('unrecognized')
    expect(outputLines(device)).toEqual(['one', 'two', 'three'])
    expect(consoleMessages(device)).toEqual(['one', 'two', 'three'])
    const started = indexOfCall(device, isExec('startInstaller'))
    const waiting = indexOfCall(device, isPhase('waiting-runtime', false))
    const pollSleeps = device.log.slice(started, waiting).filter((call) => call.kind === 'sleep')
    expect(pollSleeps.length).toBeGreaterThanOrEqual(3)
    expect(pollSleeps).toEqual(pollSleeps.map(() => expect.objectContaining({ ms: INSTALLER_POLL_INTERVAL_MS })))
  })

  it('ends unknown when the prepared directory is not safe, without starting the installer', async () => {
    const { device, service } = setup({
      commands: { prepareInstaller: { stdout: 'dir=/tmp/x;reboot\ndownload=ok\n' } },
    })

    await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'unknown' })
    expect(namesAfterInspection(device)).toEqual(['prepareInstaller'])
  })

  it('ends unknown when a poll cannot be read', async () => {
    const { device, service } = setup({ polls: [{ exit: 'running', raw: 'garbage' }] })

    await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'unknown' })
    expect(namesAfterInspection(device)).toEqual(['prepareInstaller', 'startInstaller', 'pollInstaller'])
  })

  it.each([
    ['Docker absent at inspection', { docker: 'absent' }, false],
    ['Docker installed at inspection', { docker: 'active' }, true],
  ] satisfies [string, RuntimeFactsInput, boolean][])(
    'reports a failed installer download with %s, from the inspection (TC38 row 1, BR21)',
    async (_, facts, dockerPresent) => {
      const { device, service } = setup({
        runtime: runtimeOutput(facts),
        commands: { prepareInstaller: { stdout: 'dir=/tmp/tmp.Xy7Qa9Zk2B\ndownload=failed\n' } },
      })

      await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'download-failed', dockerPresent })
      expect(namesAfterInspection(device)).toEqual(['prepareInstaller'])
    },
  )

  it.each([
    [
      'the Docker installer download failure, with Docker still absent (TC38 row 2)',
      '[ERROR] Could not download the Docker installer.\n',
      'docker=no\n',
      false,
    ],
    [
      'an image pull failure, with Docker installed by then (TC38 row 3, R.4)',
      '[ERROR] Could not pull ghcr.io/autonomy-logic/openplc-runtime:latest, and no local copy is present.\n',
      'docker=yes\n',
      true,
    ],
  ])('reports a download failure after %s, reading Docker presence again', async (_, line, docker, dockerPresent) => {
    const { device, service } = setup({
      runtime: runtimeOutput({ docker: 'absent' }),
      polls: [{ exit: 'running', text: `Installing\n${line}` }, { exit: 1 }],
      commands: { dockerPresent: { stdout: docker } },
    })

    await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'download-failed', dockerPresent })
    expect(namesAfterInspection(device).slice(-2)).toEqual(['pollInstaller', 'dockerPresent'])
    expect(checkCalls(device)).toEqual([])
  })

  it('reports an installer failure with its last 200 lines, bounded and without the password (TC39, AC09.5)', async () => {
    const longLine = `line 230 ${'w'.repeat(LINE_CHAR_LIMIT - 12)}${PASSWORD}${'w'.repeat(5000)}`.slice(0, 5000)
    const original = Array.from({ length: 240 }, (_, index) => {
      const number = index + 1
      if (number === 230) return longLine
      if (number % 37 === 0) return `line ${number} sudo echoed ${PASSWORD}`
      return `line ${number}`
    })
    const { device, service } = setup({ polls: installerPolls(`${original.join('\n')}\n`, 777, 1) })

    const outcome = await service.run(REQUEST)
    const output = outputLines(device)

    expect(outcome).toEqual({ kind: 'installer-failed', lastLines: expect.any(Array) })
    expect(output).toHaveLength(240)
    expect(consoleMessages(device)).toEqual(output)
    expect(lastLinesOf(outcome)).toHaveLength(DIALOG_LINE_LIMIT)
    expect(lastLinesOf(outcome)).toEqual(output.slice(40))
    expect(lastLinesOf(outcome)[0]).toBe('line 41')
    expect(output[229]).toBe(truncated(longLine.replace(PASSWORD, PASSWORD_MASK)))
    expect(JSON.stringify({ outcome, events: events(device) })).not.toContain('S3c')
    expect(checkCalls(device)).toEqual([])
  })

  it('bounds 10,050 installer lines: 10,000 console lines and a marker, the last 200 in the dialog (TC55)', async () => {
    const original = Array.from({ length: 10_050 }, (_, index) => {
      const number = index + 1
      if (number === 10_000) return 'line 10000 '.padEnd(LINE_CHAR_LIMIT, 'm')
      if (number === 10_001) return 'line 10001 '.padEnd(LINE_CHAR_LIMIT + 1, 'n')
      return `line ${number}`
    })
    const { device, service } = setup({ polls: installerPolls(`${original.join('\n')}\n`, POLL_READ_BYTES, 2) })

    const outcome = await service.run(REQUEST)
    const consoleLines = consoleMessages(device)
    const lastLines = lastLinesOf(outcome)

    expect(outcome.kind).toBe('installer-failed')
    expect(outputLines(device)).toHaveLength(10_050)
    expect(consoleLines).toHaveLength(CONSOLE_LINE_LIMIT + 1)
    expect(consoleLines.slice(0, CONSOLE_LINE_LIMIT)).toEqual(original.slice(0, CONSOLE_LINE_LIMIT))
    expect(consoleLines[9999]).toHaveLength(LINE_CHAR_LIMIT)
    expect(consoleLines[CONSOLE_LINE_LIMIT]).toBe(OUTPUT_TRUNCATED_LINE)
    expect(lastLines).toHaveLength(DIALOG_LINE_LIMIT)
    expect(lastLines[0]).toBe('line 9851')
    expect(lastLines[150]).toBe(truncated(original[10_000]))
  })

  it.each([
    ['answers 119 s later', 119_000, { kind: 'connected-ready', operation: 'install' }],
    [
      'has not answered 120 s later',
      null,
      { kind: 'not-started', operation: 'install', lastLines: DEFAULT_INSTALLER_LINES },
    ],
  ] satisfies [string, number | null, RuntimeProvisioningOutcome][])(
    'after the installer exits 0, when 8443 %s (TC35)',
    async (_, runtimeAnswersAfterMs, expected) => {
      const { service } = setup({ runtimeAnswersAfterMs })

      await expect(service.run(REQUEST)).resolves.toEqual(expected)
    },
  )

  it('reports not started when 8443 only returns an error status after the installer exits 0 (TC35)', async () => {
    const { service } = setup({
      reachability: () => ({ kind: 'response', statusCode: 503, body: 'recovery' }),
    })

    await expect(service.run(REQUEST)).resolves.toEqual({
      kind: 'not-started',
      operation: 'install',
      lastLines: DEFAULT_INSTALLER_LINES,
    })
  })
})

describe('installer output never leaks the password (AS-09)', () => {
  const cutLine = `${'x'.repeat(LINE_CHAR_LIMIT - 6)}${PASSWORD}${'y'.repeat(100)}`

  it.each([
    [
      'whole in one read',
      [{ exit: 'running', text: `password is ${PASSWORD}\n` }, { exit: 0 }],
      [`password is ${PASSWORD_MASK}`],
    ],
    [
      'split across two polls',
      [{ exit: 'running', text: 'echo S3cr3' }, { exit: 'running', text: 't-Pi! ok\n' }, { exit: 0 }],
      [`echo ${PASSWORD_MASK} ok`],
    ],
    [
      'at the start of a 64 KiB tail read that begins mid-password',
      [
        { exit: 'running', text: 'starting\n' },
        { exit: 'running', from: 70_000, text: 't-Pi! leaked?\nclean line\n' },
        { exit: 0 },
      ],
      ['starting', 'clean line'],
    ],
    [
      'across the 4,096-character cut',
      [{ exit: 'running', text: `${cutLine}\n` }, { exit: 0 }],
      [truncated(`${'x'.repeat(LINE_CHAR_LIMIT - 6)}${PASSWORD_MASK}${'y'.repeat(100)}`)],
    ],
  ] satisfies [string, InstallerPollReply[], string[]][])('scrubs a password %s', async (_, polls, expected) => {
    const { device, service } = setup({ polls })

    const outcome = await service.run(REQUEST)

    expect(outputLines(device)).toEqual(expected)
    expect(JSON.stringify({ outcome, events: events(device) })).not.toContain('S3cr')
    expect(JSON.stringify({ outcome, events: events(device) })).not.toContain('t-Pi!')
  })

  it('masks every a of the one-character password "a"', async () => {
    const { device, service } = setup({
      devicePassword: 'a',
      polls: [{ exit: 'running', text: 'banana\nabc\n' }, { exit: 2 }],
    })

    const outcome = await service.run({ ...REQUEST, password: 'a' })

    expect(outcome.kind).toBe('installer-failed')
    expect(outputLines(device)).toHaveLength(2)
    expect([...outputLines(device), ...consoleMessages(device), ...lastLinesOf(outcome)].join('\n')).not.toContain('a')
  })
})

describe('installer output decoded as one UTF-8 stream across polls (M15, AS-09)', () => {
  const UTF8_PASSWORD = 'Pässwört-€1'
  const MASKED_LINE = `sudo echoed ${PASSWORD_MASK} here`

  it('masks a non-ASCII password split between two polls inside the bytes of one character', async () => {
    const line = utf8Bytes(`sudo echoed ${UTF8_PASSWORD} here\n`)
    const insideEuro = line.indexOf(0xe2) + 1
    const { device, service } = setup({
      devicePassword: UTF8_PASSWORD,
      polls: [
        { exit: 'running', bytes: line.subarray(0, insideEuro) },
        { exit: 'running', bytes: line.subarray(insideEuro) },
        { exit: 1 },
      ],
    })

    const outcome = await service.run({ ...REQUEST, password: UTF8_PASSWORD })
    const shown = [
      ...outputLines(device),
      ...consoleMessages(device),
      ...lastLinesOf(outcome),
      ...auditEvents(device),
      ...auditWrites(device),
    ].join('\n')

    expect(outcome.kind).toBe('installer-failed')
    expect(outputLines(device)).toEqual([MASKED_LINE])
    expect(consoleMessages(device)).toEqual([MASKED_LINE])
    expect(lastLinesOf(outcome)).toEqual([MASKED_LINE])
    for (const fragment of [UTF8_PASSWORD, 'Pässwört', '€1', '\uFFFD']) expect(shown).not.toContain(fragment)
  })

  it('counts the poll offset in bytes, so a multi-byte log is followed with no unrecognized poll', async () => {
    const { device, service } = setup({
      polls: [
        { exit: 'running', text: 'Grüße aus München\n' },
        { exit: 'running', text: 'Größe: 5 €\n' },
        { exit: 0, text: 'Fertig\n' },
      ],
    })

    await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'connected-ready', operation: 'install' })
    expect(commandNames(device)).not.toContain('unrecognized')
    expect(outputLines(device)).toEqual(['Grüße aus München', 'Größe: 5 €', 'Fertig'])
  })
})

describe('a flooding installer (AS-12)', () => {
  const FLOOD_LINES = 'flood line\n'.repeat(5957)
  const LONG_WINDOW = 'h'.repeat(POLL_READ_BYTES)
  const GIB = 1_073_741_824

  function floodPoll(index: number): InstallerPollReply {
    if (index < 3) return { exit: 'running', text: FLOOD_LINES }
    if (index < 5) return { exit: 'running', text: LONG_WINDOW }
    if (index === 5) return { exit: 'running', text: '\nafter the long line\n' }
    if (index < 16) {
      const size = Math.round((GIB * (index - 5)) / 10)
      const text = index === 8 ? LONG_WINDOW : `ine\n${FLOOD_LINES}`.slice(0, POLL_READ_BYTES)
      return { exit: 'running', from: size - text.length, size, text }
    }
    return { exit: 1, text: 'flood ended\n' }
  }

  it('keeps every poll at 64 KiB and every bound while the log grows to 1 GiB', async () => {
    const { device, service } = setup({ polls: ({ index }) => floodPoll(index) })

    const outcome = await service.run(REQUEST)
    const lineLimit = LINE_CHAR_LIMIT + LINE_TRUNCATION_MARKER.length
    const consoleLines = consoleMessages(device)

    expect(outcome.kind).toBe('installer-failed')
    expect(commandNames(device).filter((name) => name === 'pollInstaller')).toHaveLength(17)
    expect(commandNames(device)).not.toContain('unrecognized')
    expect(lastLinesOf(outcome).length).toBeLessThanOrEqual(DIALOG_LINE_LIMIT)
    expect(lastLinesOf(outcome).every((line) => line.length <= lineLimit)).toBe(true)
    expect(outputLines(device).every((line) => line.length <= lineLimit)).toBe(true)
    expect(consoleLines).toHaveLength(CONSOLE_LINE_LIMIT + 1)
    expect(consoleLines[CONSOLE_LINE_LIMIT]).toBe(OUTPUT_TRUNCATED_LINE)
    const started = indexOfCall(device, isPhase('installing', false))
    expect(callsAfter(device, started).filter(isPhase('installing', true))).toEqual([])
    expect(phaseEvents(device).filter((event) => event.cancellable)).toHaveLength(3)
  })

  it('ends unknown when cancelled during the flood, with no poll after (project close)', async () => {
    let cancelled: Promise<void> = Promise.resolve()
    const harness: Harness = setup({
      polls: ({ index }) => {
        if (index === 10) cancelled = harness.service.cancel()
        return floodPoll(index)
      },
    })

    await expect(harness.service.run(REQUEST)).resolves.toEqual({ kind: 'unknown' })
    await cancelled
    expect(commandNames(harness.device).filter((name) => name === 'pollInstaller')).toHaveLength(11)
    expect(namesAfterInspection(harness.device).slice(-1)).toEqual(['pollInstaller'])
    expect(checkCalls(harness.device)).toEqual([])
  })
})

describe('cancel', () => {
  it('does nothing with no active run', async () => {
    const { device, service } = setup()

    await service.cancel()

    expect(device.log).toEqual([])
    expect(service.inspectState()).toEqual(IDLE_STATE)
  })

  it('ends cancelled during the SSH login, with nothing changed (TC45 install, SSH login)', async () => {
    let cancelled: Promise<void> = Promise.resolve()
    const harness: Harness = setup({
      onOpen: () => {
        cancelled = harness.service.cancel()
      },
    })

    await expect(harness.service.run(REQUEST)).resolves.toEqual({ kind: 'cancelled' })
    await cancelled
    expect(commandNames(harness.device).filter((name) => STATE_CHANGING.includes(name))).toEqual([])
    expect(authCalls(harness.device)).toEqual([])
    const cancelledEntries = [
      expectedAudit(harness.device, REQUEST, 'inspect', 'cancelled'),
      expectedAudit(harness.device, REQUEST, 'install', 'cancelled'),
    ]
    expect(auditWrites(harness.device)).toHaveLength(1)
    expect(cancelledEntries).toContain(auditWrites(harness.device)[0])
  })

  it('ends cancelled during the device inspection of an install (TC45 install, inspection)', async () => {
    let cancelled: Promise<void> = Promise.resolve()
    const harness: Harness = setup({
      commands: {
        probeSystem: () => {
          cancelled = harness.service.cancel()
          return { stdout: systemOutput() }
        },
      },
    })

    await expect(harness.service.run(REQUEST)).resolves.toEqual({ kind: 'cancelled' })
    await cancelled
    expect(commandNames(harness.device).filter((name) => STATE_CHANGING.includes(name))).toEqual([])
    expect(checkCalls(harness.device)).toEqual([])
  })

  it('ends cancelled during the device inspection of a start, sending no start command (TC45 start)', async () => {
    let cancelled: Promise<void> = Promise.resolve()
    const harness: Harness = setup({
      commands: {
        inspectRuntime: () => {
          cancelled = harness.service.cancel()
          return { stdout: runtimeOutput({ docker: 'active', bootloader: 'running', runtimeContainer: 'stopped' }) }
        },
      },
    })

    await expect(harness.service.run(REQUEST)).resolves.toEqual({ kind: 'cancelled' })
    await cancelled
    expect(namesAfterInspection(harness.device)).toEqual([])
    expect(phaseFlags(harness.device).filter(([, cancellable]) => !cancellable)).toEqual([])
  })

  it('ends cancelled when cancelled while the installer is prepared, never starting it', async () => {
    let cancelled: Promise<void> = Promise.resolve()
    const harness: Harness = setup({
      commands: {
        prepareInstaller: () => {
          cancelled = harness.service.cancel()
          return { stdout: 'dir=/tmp/tmp.Xy7Qa9Zk2B\ndownload=ok\n' }
        },
      },
    })

    await expect(harness.service.run(REQUEST)).resolves.toEqual({ kind: 'cancelled' })
    await cancelled
    expect(namesAfterInspection(harness.device)).toEqual(['prepareInstaller'])
    expect(auditWrites(harness.device)).toEqual([expectedAudit(harness.device, REQUEST, 'install', 'cancelled')])
  })

  it('stops following and ends unknown once the installer started (TC45 installer started, TC50 project close)', async () => {
    let cancelled: Promise<void> = Promise.resolve()
    const harness: Harness = setup({
      polls: ({ index }) => {
        if (index === 0) cancelled = harness.service.cancel()
        return { exit: 'running', text: `progress ${index}\n` }
      },
    })

    await expect(harness.service.run(REQUEST)).resolves.toEqual({ kind: 'unknown' })
    await cancelled
    expect(namesAfterInspection(harness.device)).toEqual(['prepareInstaller', 'startInstaller', 'pollInstaller'])
    expect(checkCalls(harness.device)).toEqual([])
    expect(harness.device.sessionClosed()).toBe(true)
    expect(countOf(harness.device, 'open')).toBe(1)
    expect(auditWrites(harness.device)).toEqual([expectedAudit(harness.device, REQUEST, 'install', 'unknown')])
  })

  it('stops following at once when cancelled between two polls, aborting the pending sleep', async () => {
    const harness: Harness = setup({
      polls: ({ index }) => {
        if (index === 0) harness.device.clock.hold()
        return { exit: 'running', text: `progress ${index}\n` }
      },
    })

    const outcome = harness.service.run(REQUEST)
    await harness.device.clock.nextSleep()
    await harness.service.cancel()

    await expect(outcome).resolves.toEqual({ kind: 'unknown' })
    expect(commandNames(harness.device).filter((name) => name === 'pollInstaller')).toHaveLength(1)
    expect(harness.device.clock.pendingSleeps()).toBe(0)
  })

  it('stops following and ends unknown once the start command was sent (TC45 start command sent)', async () => {
    let cancelled: Promise<void> = Promise.resolve()
    const harness: Harness = setup({
      runtime: runtimeOutput({ docker: 'active', bootloader: 'running', runtimeContainer: 'stopped' }),
      commands: {
        startRuntimeContainer: () => {
          cancelled = harness.service.cancel()
          return { stdout: 'openplc-runtime\n' }
        },
      },
    })

    await expect(harness.service.run(REQUEST)).resolves.toEqual({ kind: 'unknown' })
    await cancelled
    expect(namesAfterInspection(harness.device)).toEqual(['startRuntimeContainer'])
    expect(checkCalls(harness.device)).toEqual([])
    expect(harness.device.sessionClosed()).toBe(true)
  })
})

describe('cancel ends the run at once while Cancel is offered (F23, TC45, AC09.4, BR27)', () => {
  it.each([
    ['the device inspection', 'probeSystem', 'inspect', []],
    ['the installer download', 'prepareInstaller', 'install', ['prepareInstaller']],
  ] satisfies [string, FixedCommandName, AuditOperation, RecordedCommandName[]][])(
    'ends cancelled during %s while its command never settles, even after the session closes',
    async (_, name, operation, sentAfterInspection) => {
      const { device, service, reached } = setupStuckOn(name)
      const outcome = service.run(REQUEST)
      await untilTrue(reached)
      expect(reached()).toBe(true)
      const sentBeforeCancel = execCalls(device).length

      await service.cancel()
      const afterCancel = {
        state: service.inspectState(),
        sessionClosed: device.sessionClosed(),
        audit: auditWrites(device),
      }
      const ending = await settledWithin(outcome)

      expect({ ...afterCancel, ending }).toEqual({
        state: IDLE_STATE,
        sessionClosed: true,
        audit: [expectedAudit(device, REQUEST, operation, 'cancelled')],
        ending: { kind: 'cancelled' },
      })
      expect(execCalls(device)).toHaveLength(sentBeforeCancel)
      expect(namesAfterInspection(device)).toEqual(sentAfterInspection)
    },
  )

  it.each(['probeSystem', 'prepareInstaller'] satisfies FixedCommandName[])(
    'accepts a new run once a cancel during %s returned',
    async (name) => {
      const { device, service, reached } = setupStuckOn(name)
      void service.run(REQUEST)
      await untilTrue(reached)

      await service.cancel()

      expect(await settledWithin(service.run(REQUEST))).toEqual({ kind: 'connected-ready', operation: 'install' })
      expect(countOf(device, 'open')).toBe(2)
    },
  )

  it.each([
    ['a cancel', (service: RuntimeProvisioningService) => service.cancel(), { kind: 'cancelled' }],
    ['a detach', (service: RuntimeProvisioningService) => service.detach('quit'), { kind: 'unknown' }],
  ] satisfies [string, (service: RuntimeProvisioningService) => Promise<void> | void, RuntimeProvisioningOutcome][])(
    'closes at once a session that finishes opening after %s while connecting, and sends nothing on it (M14)',
    async (_, end, expected) => {
      const { device, service } = setupEndingWhileOpening(end)

      const ending = await settledWithin(service.run(REQUEST))
      await untilTrue(() => device.sessionClosed())

      expect(ending).toEqual(expected)
      expect(countOf(device, 'open')).toBe(1)
      expect(device.sessionClosed()).toBe(true)
      expect(execCalls(device)).toEqual([])
      expect(auditWrites(device)).toHaveLength(1)
    },
  )
})

describe('nothing reaches the device once the run has an outcome (M14, AS-19)', () => {
  it('saves no host key and trusts none when the host-key check comes after a detach', async () => {
    const { device, service, opened } = setupHeldOpen()
    const outcome = service.run(REQUEST)
    const held = await opened

    service.detach('quit')
    const trusted = await held.request.verifyHostKey(ED25519_AAAA)
    held.finish(OPEN_FAILED)

    await expect(outcome).resolves.toEqual({ kind: 'unknown' })
    expect(trusted).toBe(false)
    expect(countOf(device, 'host-key-replace')).toBe(0)
    expect(device.hostKeyFile()).toEqual({ kind: 'absent' })
    expect(auditWrites(device)).toEqual([expectedAudit(device, REQUEST, 'inspect', 'unknown')])
  })

  it.each([
    ['before any method was tried', null],
    ['when password is offered', ['password']],
    ['when publickey and password are offered', ['publickey', 'password']],
  ] satisfies [string, string[] | null][])(
    'answers stop to the authentication choice %s after a detach',
    async (_, methodsLeft) => {
      const { device, service, opened } = setupHeldOpen()
      const outcome = service.run(REQUEST)
      const held = await opened

      service.detach('renderer-gone')
      const choice = held.request.chooseAuth(methodsLeft)
      held.finish(OPEN_FAILED)

      await expect(outcome).resolves.toEqual({ kind: 'unknown' })
      expect(choice).toBe('stop')
      expect(auditWrites(device)).toHaveLength(1)
    },
  )

  it('trusts no key, sends no authentication and ends cancelled when cancelled while connecting (TC45 SSH login)', async () => {
    const { device, service, opened } = setupHeldOpen()
    const outcome = service.run(REQUEST)
    const held = await opened

    await service.cancel()
    const trusted = await held.request.verifyHostKey(ED25519_AAAA)
    const choices = [held.request.chooseAuth(null), held.request.chooseAuth(['password'])]
    held.finish(OPEN_FAILED)

    await expect(outcome).resolves.toEqual({ kind: 'cancelled' })
    expect(trusted).toBe(false)
    expect(choices).toEqual(['stop', 'stop'])
    expect(countOf(device, 'host-key-replace')).toBe(0)
    expect(auditWrites(device)).toEqual([expectedAudit(device, REQUEST, 'inspect', 'cancelled')])
  })

  it('resolves the host-key check false when the run ends while the first-use key is being saved', async () => {
    const replaced: string[] = []
    let finishSave: () => void = () => undefined
    const { device, service, opened } = setupHeldOpen((text) => {
      replaced.push(text)
      return new Promise<void>((resolve) => {
        finishSave = resolve
      })
    })
    const outcome = service.run(REQUEST)
    const held = await opened

    const trusted = held.request.verifyHostKey(ED25519_AAAA)
    service.detach('quit')
    finishSave()

    await expect(trusted).resolves.toBe(false)
    held.finish(OPEN_FAILED)
    await expect(outcome).resolves.toEqual({ kind: 'unknown' })
    expect(replaced).toHaveLength(1)
    expect(auditWrites(device)).toHaveLength(1)
  })

  it.each([
    ['a cancel', (service: RuntimeProvisioningService) => void service.cancel(), { kind: 'cancelled' }],
    ['a detach', (service: RuntimeProvisioningService) => service.detach('quit'), { kind: 'unknown' }],
  ] satisfies [string, (service: RuntimeProvisioningService) => void, RuntimeProvisioningOutcome][])(
    'sends no password and saves no key after %s as the SSH session opens',
    async (_, act, ending) => {
      const harness: Harness = setup({ onOpen: () => act(harness.service) })

      await expect(harness.service.run(REQUEST)).resolves.toEqual(ending)
      await untilLogged(harness.device, 'host-key-check')
      expect(countOf(harness.device, 'host-key-check')).toBe(1)
      expect(authCalls(harness.device)).toEqual([])
      expect(countOf(harness.device, 'host-key-replace')).toBe(0)
      expect(auditWrites(harness.device)).toHaveLength(1)
    },
  )
})

describe('bounded installer following (M18, AS-12)', () => {
  const START_POLL_LIMIT = 60
  const FOLLOW_MAX_MS = 3_600_000

  function flowingOutput(index: number): InstallerPollReply {
    return { exit: 'running', text: `progress ${index}\n` }
  }

  it('ends unknown after 60 polls report a running installer and an empty log, polling no more', async () => {
    const { device, service } = setup({ polls: () => ({ exit: 'running' }) })

    await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'unknown' })
    expect(pollCount(device)).toBe(START_POLL_LIMIT)
    expect(commandNames(device).at(-1)).toBe('pollInstaller')
    expect(device.sessionClosed()).toBe(true)
    expect(phaseFlags(device).at(-1)).toEqual(['installing', false])
    expect(auditWrites(device)).toEqual([expectedAudit(device, REQUEST, 'install', 'unknown')])
  })

  it('keeps following when the log grows on the 60th poll, after 59 empty polls', async () => {
    const { device, service } = setup({
      polls: ({ index }) => {
        if (index < 59) return { exit: 'running' }
        if (index === 59) return { exit: 'running', text: 'Installing\n' }
        if (index < 150) return { exit: 'running' }
        return { exit: 0, text: 'Done\n' }
      },
    })

    await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'connected-ready', operation: 'install' })
    expect(pollCount(device)).toBe(151)
    expect(outputLines(device)).toEqual(['Installing', 'Done'])
  })

  it('ends unknown at the first running poll 60 minutes after the installer started, while output keeps flowing', async () => {
    const { device, service } = setup({ polls: ({ index }) => flowingOutput(index) })

    await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'unknown' })
    const startedAt = execCalls(device).find((call) => call.name === 'startInstaller')?.at ?? Number.NaN
    const elapsed = execCalls(device)
      .filter((call) => call.name === 'pollInstaller')
      .map((call) => call.at - startedAt)
    expect(elapsed.at(-1)).toBeGreaterThanOrEqual(FOLLOW_MAX_MS)
    expect(elapsed.at(-2)).toBeLessThan(FOLLOW_MAX_MS)
    expect(commandNames(device).at(-1)).toBe('pollInstaller')
    expect(device.sessionClosed()).toBe(true)
    expect(phaseFlags(device).at(-1)).toEqual(['installing', false])
    expect(auditWrites(device)).toEqual([expectedAudit(device, REQUEST, 'install', 'unknown')])
  })

  it.each([
    ['an empty log for 60 polls', (): InstallerPollReply => ({ exit: 'running' })],
    ['60 minutes of output', flowingOutput],
  ] satisfies [string, (index: number) => InstallerPollReply][])(
    'accepts a new run after ending on %s, instead of answering busy',
    async (_, firstRunPoll) => {
      let firstRun = true
      const { device, service } = setup({
        polls: ({ index }) => (firstRun ? firstRunPoll(index) : { exit: 0, text: 'Done\n' }),
      })

      await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'unknown' })
      firstRun = false

      await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'connected-ready', operation: 'install' })
      expect(countOf(device, 'open')).toBe(2)
    },
  )
})

describe('onEvent', () => {
  it('stops calling a callback once its unsubscribe is called, while another subscriber still gets events', async () => {
    const first: RuntimeProvisioningEvent[] = []
    const second: RuntimeProvisioningEvent[] = []
    let unsubscribeFirst: () => void = () => undefined
    const harness: Harness = setup({ onOpen: () => unsubscribeFirst() })
    unsubscribeFirst = harness.service.onEvent((event) => first.push(event))
    harness.service.onEvent((event) => second.push(event))

    await harness.service.run(REQUEST)

    expect(first).toEqual([{ type: 'phase', phase: 'connecting', cancellable: true }])
    expect(second.length).toBeGreaterThan(1)
    expect(second[0]).toEqual(first[0])
  })
})

describe('detach and a lost channel', () => {
  it('does nothing with no active run', () => {
    const { device, service } = setup()

    service.detach('quit')

    expect(device.log).toEqual([])
  })

  const detachReasons: ('quit' | 'renderer-gone')[] = ['quit', 'renderer-gone']

  it.each(detachReasons)(
    'ends unknown with the audit entry and no new login when detached for %s during the install (TC50)',
    async (reason) => {
      const harness: Harness = setup({
        polls: ({ index }) => {
          if (index === 1) harness.service.detach(reason)
          return { exit: 'running', text: `progress ${index}\n` }
        },
      })

      await expect(harness.service.run(REQUEST)).resolves.toEqual({ kind: 'unknown' })
      expect(commandNames(harness.device).filter((name) => name === 'pollInstaller')).toHaveLength(2)
      expect(countOf(harness.device, 'open')).toBe(1)
      expect(harness.device.sessionClosed()).toBe(true)
      expect(auditWrites(harness.device)).toEqual([expectedAudit(harness.device, REQUEST, 'install', 'unknown')])
      expect(auditEvents(harness.device)).toEqual(auditWrites(harness.device))
    },
  )

  it('ends unknown when detached during a cancellable phase', async () => {
    const harness: Harness = setup({
      commands: {
        probeSystem: () => {
          harness.service.detach('renderer-gone')
          return { stdout: systemOutput() }
        },
      },
    })

    await expect(harness.service.run(REQUEST)).resolves.toEqual({ kind: 'unknown' })
    expect(commandNames(harness.device)).toEqual(['probeSystem'])
    expect(auditWrites(harness.device)).toEqual([expectedAudit(harness.device, REQUEST, 'inspect', 'unknown')])
  })

  it('stops at once when detached while waiting between polls, aborting the pending sleep', async () => {
    const harness: Harness = setup({
      polls: ({ index }) => {
        if (index === 0) harness.device.clock.hold()
        return { exit: 'running', text: `progress ${index}\n` }
      },
    })

    const outcome = harness.service.run(REQUEST)
    await harness.device.clock.nextSleep()
    harness.service.detach('quit')

    await expect(outcome).resolves.toEqual({ kind: 'unknown' })
    expect(auditWrites(harness.device)).toHaveLength(1)
    expect(harness.device.clock.pendingSleeps()).toBe(0)
  })

  it('ends unknown when the channel drops during the install, with no new login (AS-19)', async () => {
    const harness: Harness = setup({
      polls: ({ index }) => {
        if (index === 1) harness.device.dropConnection()
        return { exit: 'running', text: `progress ${index}\n` }
      },
    })

    await expect(harness.service.run(REQUEST)).resolves.toEqual({ kind: 'unknown' })
    const dropped = indexOfCall(harness.device, (call) => call.kind === 'drop')
    expect(callsAfter(harness.device, dropped).filter((call) => call.kind === 'exec' || call.kind === 'open')).toEqual(
      [],
    )
    expect(countOf(harness.device, 'open')).toBe(1)
    expect(JSON.stringify(harness.service.inspectState())).not.toContain(PASSWORD)
    expect(harness.service.inspectState()).toEqual(IDLE_STATE)
  })

  it('ends unknown when the channel closes while waiting between polls, aborting the pending sleep', async () => {
    const harness: Harness = setup({
      polls: ({ index }) => {
        if (index === 0) harness.device.clock.hold()
        return { exit: 'running', text: `progress ${index}\n` }
      },
    })

    const outcome = harness.service.run(REQUEST)
    await harness.device.clock.nextSleep()
    harness.device.dropConnection()

    await expect(outcome).resolves.toEqual({ kind: 'unknown' })
    expect(countOf(harness.device, 'open')).toBe(1)
    expect(harness.device.clock.pendingSleeps()).toBe(0)
  })

  it('ends unknown when a command fails to run', async () => {
    const { device, service } = setup({ commands: { inspectRuntime: { rejectWith: 'channel open failure' } } })

    await expect(service.run(REQUEST)).resolves.toEqual({ kind: 'unknown' })
    expect(namesAfterInspection(device)).toEqual([])
    expect(countOf(device, 'open')).toBe(1)
  })

  it.each([
    ['a success', {}],
    ['v3 present', { runtime: runtimeOutput({ v3: ['openplc.service'] }) }],
    ['an unreadable probe', { system: 'garbage\n' }],
    ['an installer failure', { polls: [{ exit: 'running', text: 'boom\n' }, { exit: 3 }] }],
  ] satisfies [string, FakeDeviceOptions][])('closes the session and unsubscribes after %s', async (_, options) => {
    const { device, service } = setup(options)

    await service.run(REQUEST)

    expect(device.sessionClosed()).toBe(true)
    expect(device.closedListeners()).toBe(0)
    expect(service.inspectState()).toEqual(IDLE_STATE)
  })
})

describe('audit entry (TC54, AS-15, M13)', () => {
  function startFailure(): Harness {
    return setup({
      runtime: runtimeOutput({ native: 'inactive' }),
      commands: { startNativeService: { exitCode: 1, stderr: 'Failed to start openplc-runtime.service\n' } },
    })
  }

  function installCancelled(): Harness {
    const harness: Harness = setup({
      commands: {
        prepareInstaller: () => {
          void harness.service.cancel()
          return { stdout: 'dir=/tmp/tmp.Xy7Qa9Zk2B\ndownload=ok\n' }
        },
      },
    })
    return harness
  }

  function installUnknown(): Harness {
    const harness: Harness = setup({
      polls: ({ index }) => {
        harness.service.detach('quit')
        return { exit: 'running', text: `progress ${index}\n` }
      },
    })
    return harness
  }

  it.each([
    ['install', 'success', () => setup()],
    ['start', 'failure', startFailure],
    ['inspect', 'failure', () => setup({ runtime: runtimeOutput({ v3: ['openplc.service'] }) })],
    ['install', 'cancelled', installCancelled],
    ['install', 'unknown', installUnknown],
  ] satisfies [AuditOperation, AuditOutcome, () => Harness][])(
    'writes and emits one %s entry with the outcome %s and no credentials',
    async (operation, outcome, scenario) => {
      const { device, service } = scenario()

      await service.run(REQUEST)

      const expected = expectedAudit(device, REQUEST, operation, outcome)
      expect(auditWrites(device)).toEqual([expected])
      expect(auditEvents(device)).toEqual([expected])
      expect(expected).not.toContain(USERNAME)
      expect(expected).not.toContain(PASSWORD)
    },
  )

  it('writes no audit entry for a busy run', async () => {
    const busy: Promise<RuntimeProvisioningOutcome>[] = []
    const harness: Harness = setup({
      commands: {
        probeSystem: () => {
          if (busy.length === 0) busy.push(harness.service.run(REQUEST))
          return { stdout: systemOutput() }
        },
      },
    })

    await harness.service.run(REQUEST)

    await expect(Promise.all(busy)).resolves.toEqual([{ kind: 'busy' }])
    expect(auditWrites(harness.device)).toHaveLength(1)
    expect(auditEvents(harness.device)).toHaveLength(1)
  })
})

describe('commands and credentials', () => {
  const HOSTILE_USERNAME = 'pi; rm -rf /'
  const HOSTILE_PASSWORD = 'x$(reboot)`id`\'"'

  it('runs only the fixed commands with a hostile username and password (AS-04)', async () => {
    const request = { ...REQUEST, username: HOSTILE_USERNAME, password: HOSTILE_PASSWORD }
    const { device, service } = setup({ devicePassword: HOSTILE_PASSWORD })

    await expect(service.run(request)).resolves.toEqual({ kind: 'connected-ready', operation: 'install' })
    const calls = execCalls(device)
    expect(calls.map((call) => call.name)).not.toContain('unrecognized')
    for (const call of calls) {
      expect(call.command).not.toContain(HOSTILE_USERNAME)
      expect(call.command).not.toContain(HOSTILE_PASSWORD)
      expect(call.command.split(/\s+/)).not.toContain('-E')
      if ((call.stdin ?? '').includes(HOSTILE_PASSWORD)) {
        expect(call.command.startsWith("/usr/bin/sudo -S -k -p '' ")).toBe(true)
      }
    }
  })

  function snapshotStates(harness: Harness): string[] {
    const states: string[] = []
    harness.service.onEvent(() => states.push(JSON.stringify(harness.service.inspectState())))
    return states
  }

  it.each([
    ['a successful install', {}, PASSWORD],
    ['a successful start', { runtime: runtimeOutput({ native: 'inactive' }) }, PASSWORD],
    ['the login rejected', {}, 'wrong-pass'],
    [
      'an installer failure whose output echoes the password',
      { polls: [{ exit: 'running', text: `[sudo] ${PASSWORD}\nerror ${PASSWORD}\n` }, { exit: 1 }] },
      PASSWORD,
    ],
  ] satisfies [string, FakeDeviceOptions, string][])(
    'never carries the credentials in events, outcome, audit or state after %s (TC21)',
    async (_, options, password) => {
      const harness = setup(options)
      const states = snapshotStates(harness)

      const outcome = await harness.service.run({ ...REQUEST, password })
      const everything = JSON.stringify({ outcome, events: events(harness.device), states })

      expect(states.length).toBeGreaterThan(0)
      expect(everything).not.toContain(password)
      expect(everything).not.toContain(USERNAME)
    },
  )

  it('never carries the credentials after the channel was lost (TC21)', async () => {
    const harness: Harness = setup({
      polls: ({ index }) => {
        harness.device.dropConnection()
        return { exit: 'running', text: `progress ${index}\n` }
      },
    })
    const states = snapshotStates(harness)

    const outcome = await harness.service.run(REQUEST)
    const everything = JSON.stringify({ outcome, events: events(harness.device), states })

    expect(outcome).toEqual({ kind: 'unknown' })
    expect(everything).not.toContain(PASSWORD)
    expect(everything).not.toContain(USERNAME)
  })
})

describe('inspectState', () => {
  it('is idle before and after a run', async () => {
    const { service } = setup()

    expect(service.inspectState()).toEqual(IDLE_STATE)
    await service.run(REQUEST)
    expect(service.inspectState()).toEqual(IDLE_STATE)
  })

  it('follows the target, phase, operation and Cancel availability as JSON-safe data', async () => {
    const snapshots: unknown[] = []
    const harness: Harness = setup({
      onOpen: () => snapshots.push(harness.service.inspectState()),
      commands: {
        probeSystem: () => {
          snapshots.push(harness.service.inspectState())
          return { stdout: systemOutput() }
        },
      },
      polls: () => {
        snapshots.push(harness.service.inspectState())
        return { exit: 0, text: 'Done\n' }
      },
      reachability: () => {
        snapshots.push(harness.service.inspectState())
        return RUNTIME_ANSWERED
      },
    })

    await harness.service.run(REQUEST)

    const base = { active: true, target: TARGET }
    expect(snapshots).toEqual([
      { ...base, phase: 'connecting', operation: 'inspect', cancellable: true },
      { ...base, phase: 'inspecting', operation: 'inspect', cancellable: true },
      { ...base, phase: 'installing', operation: 'install', cancellable: false },
      { ...base, phase: 'waiting-runtime', operation: 'install', cancellable: false },
    ])
    expect(JSON.parse(JSON.stringify(snapshots))).toEqual(snapshots)
  })

  it('reports the start operation once the start command is sent', async () => {
    const snapshots: unknown[] = []
    const harness: Harness = setup({
      runtime: runtimeOutput({ native: 'inactive' }),
      commands: {
        startNativeService: () => {
          snapshots.push(harness.service.inspectState())
          return { exitCode: 0 }
        },
      },
    })

    await harness.service.run(REQUEST)

    expect(snapshots).toEqual([
      { active: true, target: TARGET, phase: 'starting', operation: 'start', cancellable: false },
    ])
  })
})
