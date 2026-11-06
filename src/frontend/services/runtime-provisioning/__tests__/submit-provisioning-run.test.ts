import type { DevicePort } from '../../../../middleware/shared/ports/device-port'
import type {
  RunRequestField,
  RuntimeProvisioningOutcome,
} from '../../../../middleware/shared/ports/runtime-provisioning-port'
import type { OpenPLCStore } from '../../../store'
import { createTestStore } from '../../../store/testing'
import {
  connectionStatus,
  createCallLog,
  createFakeDevice,
  DEVICE_IP,
  FakeProvisioning,
  FakeRuntime,
  type PortCallLog,
  REFUSED,
  RUNTIME_V4,
  selectRuntimeTarget,
  serializedState,
  settle,
  SSH_PASSWORD,
  SSH_USERNAME,
  unexpectedCalls,
} from '../../__tests__/fixtures/runtime-ports'
import { connectRuntime } from '../../runtime-connect'
import { submitProvisioningRun } from '..'

type RunInput = { username: string; password: string; sshPort: number }

const STARTED_AT = 1_700_000_000_000
const ENDED_AT = 1_700_000_090_000

const VALID_INPUT: RunInput = { username: SSH_USERNAME, password: SSH_PASSWORD, sshPort: 22 }

const INVALID_INPUTS: [string, RunInput, RunRequestField][] = [
  ['an empty username', { ...VALID_INPUT, username: '' }, 'username'],
  ['a username longer than 32 characters', { ...VALID_INPUT, username: 'u'.repeat(33) }, 'username'],
  ['an empty password', { ...VALID_INPUT, password: '' }, 'password'],
  ['a password with a control character', { ...VALID_INPUT, password: 'S3cr3t\u0000-Pi!' }, 'password'],
  ['SSH port 0', { ...VALID_INPUT, sshPort: 0 }, 'port'],
  ['SSH port 65536', { ...VALID_INPUT, sshPort: 65536 }, 'port'],
  ['a fractional SSH port', { ...VALID_INPUT, sshPort: 22.5 }, 'port'],
]

const ENDINGS_THAT_DISCONNECT: RuntimeProvisioningOutcome[] = [
  { kind: 'not-started', operation: 'install', lastLines: ['openplc-runtime: waiting for the database'] },
  { kind: 'cancelled' },
  { kind: 'unknown' },
  { kind: 'ssh-unreachable' },
  { kind: 'host-key-changed', target: '192.168.1.50:22' },
  { kind: 'host-key-file-unusable' },
  { kind: 'host-key-not-saved' },
  { kind: 'password-auth-not-accepted' },
  { kind: 'no-admin-rights' },
  { kind: 'unsupported', reason: 'arch', detail: 'mips' },
  { kind: 'v3-present' },
  { kind: 'download-failed', dockerPresent: false },
  { kind: 'installer-failed', lastLines: ['E: Unable to locate package docker-ce'] },
]

const ENDINGS_TO_SCAN: RuntimeProvisioningOutcome[] = [
  { kind: 'connected-ready', operation: 'install' },
  { kind: 'auth-rejected' },
  { kind: 'cancelled' },
  { kind: 'unknown' },
]

const SESSION_DIALOGS: [boolean, 'runtime-login' | 'runtime-create-user'][] = [
  [false, 'runtime-create-user'],
  [true, 'runtime-login'],
]

let store: OpenPLCStore
let log: PortCallLog
let runtime: FakeRuntime
let provisioning: FakeProvisioning
let device: DevicePort
let clock: number

function ports() {
  return { runtime: runtime.port, device, runtimeProvisioning: provisioning.port }
}

function slice() {
  return store.getState().runtimeProvisioning
}

function showOffer(sshPort = 22): void {
  store.getState().runtimeProvisioningActions.showOffer(DEVICE_IP, sshPort)
}

function submit(input: RunInput = VALID_INPUT): Promise<void> {
  return submitProvisioningRun(store, ports(), input)
}

function runStarted(count = 1): Promise<void> {
  return settle(() => provisioning.runRequests.length === count && provisioning.pendingRunCount === 1)
}

function consoleLines(): { level: string | undefined; message: string }[] {
  return store.getState().logs.map(({ level, message }) => ({ level, message }))
}

function operationIdOf(): number | null {
  const view = slice().view
  return view.stage === 'running' ? view.operationId : null
}

beforeEach(() => {
  store = createTestStore()
  log = createCallLog()
  runtime = new FakeRuntime(log)
  provisioning = new FakeProvisioning(log)
  device = createFakeDevice(log)
  clock = STARTED_AT
  jest.spyOn(Date, 'now').mockImplementation(() => clock)
  selectRuntimeTarget(store, RUNTIME_V4, DEVICE_IP)
})

afterEach(() => {
  jest.restoreAllMocks()
  expect(unexpectedCalls(log)).toEqual([])
})

describe('submitProvisioningRun with input the device must not see', () => {
  it.each(INVALID_INPUTS)('refuses %s without contacting the device', async (_name, input, field) => {
    showOffer()

    await submit(input)

    expect(slice().view).toEqual({
      stage: 'offer',
      host: DEVICE_IP,
      sshPort: 22,
      notice: { kind: 'input-refused', field },
    })
    expect(slice().dialogVisible).toBe(true)
    expect(log.calls).toEqual([])
    expect(provisioning.subscriberCount).toBe(0)
    expect(serializedState(store)).not.toContain('S3cr3t')
  })
})

describe('a submitted run', () => {
  beforeEach(() => {
    showOffer(2222)
  })

  it('sends the offer host, the chosen SSH port and the credentials to the device once', async () => {
    const done = submit({ ...VALID_INPUT, sshPort: 2222 })
    await runStarted()
    const running = slice().view
    provisioning.endRun({ kind: 'cancelled' })
    await done

    expect(provisioning.runRequests).toEqual([
      { host: DEVICE_IP, port: 2222, username: SSH_USERNAME, password: SSH_PASSWORD },
    ])
    expect(running).toEqual(
      expect.objectContaining({ stage: 'running', host: DEVICE_IP, sshPort: 2222, startedAt: STARTED_AT }),
    )
    expect(log.calls).toEqual(['provisioning.run'])
  })

  it('follows phase and output events into the slice', async () => {
    const done = submit({ ...VALID_INPUT, sshPort: 2222 })
    await runStarted()
    provisioning.emit({ type: 'phase', phase: 'installing', cancellable: true, operation: 'install' })
    provisioning.emit({ type: 'output', line: 'Installing Docker' })
    const running = slice().view
    provisioning.endRun({ kind: 'cancelled' })
    await done

    expect(running).toEqual(
      expect.objectContaining({
        phase: 'installing',
        cancellable: true,
        operation: 'install',
        latestLine: 'Installing Docker',
        lines: ['Installing Docker'],
      }),
    )
  })

  it('writes console and audit events to the console', async () => {
    const done = submit({ ...VALID_INPUT, sshPort: 2222 })
    await runStarted()
    provisioning.emit({ type: 'console', level: 'warning', message: 'Docker is missing and will be installed' })
    provisioning.emit({ type: 'audit', line: 'install started on 192.168.1.50:2222' })
    provisioning.endRun({ kind: 'cancelled' })
    await done

    expect(consoleLines()).toEqual(
      expect.arrayContaining([
        { level: 'warning', message: 'Docker is missing and will be installed' },
        { level: 'info', message: 'install started on 192.168.1.50:2222' },
      ]),
    )
  })

  it('stops following the operation once it ends', async () => {
    const done = submit({ ...VALID_INPUT, sshPort: 2222 })
    await runStarted()
    provisioning.emit({ type: 'output', line: 'Installing Docker' })
    provisioning.endRun({ kind: 'cancelled' })
    await done
    const ended = slice().view

    provisioning.emit({ type: 'output', line: 'a line after the end' })

    expect(provisioning.subscriberCount).toBe(0)
    expect(slice().view).toEqual(ended)
  })

  it('gives each run its own operation id', async () => {
    const first = submit({ ...VALID_INPUT, sshPort: 2222 })
    await runStarted()
    const firstId = operationIdOf()
    provisioning.endRun({ kind: 'auth-rejected' })
    await first
    const second = submit({ ...VALID_INPUT, sshPort: 2222 })
    await runStarted(2)
    const secondId = operationIdOf()
    provisioning.endRun({ kind: 'cancelled' })
    await second

    expect(typeof firstId).toBe('number')
    expect(typeof secondId).toBe('number')
    expect(secondId).not.toBe(firstId)
  })

  it.each(ENDINGS_TO_SCAN)(
    'keeps the username and password out of the store during and after a run that ends $kind',
    async (outcome) => {
      runtime.usersInfoAnswers = [{ hasUsers: false, runtimeVersion: '4.2.0' }]
      const done = submit({ ...VALID_INPUT, sshPort: 2222 })
      await runStarted()
      provisioning.emit({ type: 'phase', phase: 'connecting', cancellable: true })
      provisioning.emit({ type: 'audit', line: 'login accepted on 192.168.1.50:2222' })
      const during = serializedState(store)
      provisioning.endRun(outcome)
      await done
      const after = serializedState(store)

      expect(during).not.toContain(SSH_PASSWORD)
      expect(during).not.toContain(SSH_USERNAME)
      expect(after).not.toContain(SSH_PASSWORD)
      expect(after).not.toContain(SSH_USERNAME)
    },
  )
})

describe('the outcome of a run', () => {
  async function runEndingWith(outcome: RuntimeProvisioningOutcome, sshPort = 22): Promise<void> {
    const done = submit({ ...VALID_INPUT, sshPort })
    await runStarted()
    clock = ENDED_AT
    provisioning.endRun(outcome)
    await done
  }

  beforeEach(() => {
    showOffer()
  })

  it('returns to the offer with the same host and port after a rejected login, with no new consent', async () => {
    showOffer(2222)

    await runEndingWith({ kind: 'auth-rejected' }, 2222)
    const rejected = slice()
    const retry = submit({ ...VALID_INPUT, password: 'S3cr3t-Pi!2', sshPort: 2222 })
    await runStarted(2)
    provisioning.endRun({ kind: 'cancelled' })
    await retry

    expect(rejected.view).toEqual({
      stage: 'offer',
      host: DEVICE_IP,
      sshPort: 2222,
      notice: { kind: 'login-rejected' },
    })
    expect(rejected.dialogVisible).toBe(true)
    expect(provisioning.runRequests.map(({ host, port }) => `${host}:${port}`)).toEqual([
      `${DEVICE_IP}:2222`,
      `${DEVICE_IP}:2222`,
    ])
    expect(log.calls).toEqual(['provisioning.run', 'provisioning.run'])
    expect(connectionStatus(store)).toBe('disconnected')
  })

  it('returns to the offer naming the refused value when the device side refuses the input', async () => {
    await runEndingWith({ kind: 'invalid-input', field: 'host' })

    expect(slice().view).toEqual(
      expect.objectContaining({ stage: 'offer', host: DEVICE_IP, notice: { kind: 'input-refused', field: 'host' } }),
    )
  })

  it('shows the dialog again when another operation is already running', async () => {
    const done = submit()
    await runStarted()
    store.getState().runtimeProvisioningActions.setDialogVisible(false)
    provisioning.endRun({ kind: 'busy' })
    await done

    expect(slice().dialogVisible).toBe(true)
  })

  it.each(SESSION_DIALOGS)(
    'continues into the existing connect after success, with accounts %s, without a second Connect',
    async (hasUsers, dialog) => {
      runtime.usersInfoAnswers = [{ hasUsers, runtimeVersion: '4.2.0' }]

      await runEndingWith({ kind: 'connected-ready', operation: 'install' })

      expect(slice().view).toEqual(
        expect.objectContaining({
          stage: 'ended',
          outcome: { kind: 'connected-ready', operation: 'install' },
          endedAt: ENDED_AT,
        }),
      )
      expect(slice().dialogVisible).toBe(false)
      expect(store.getState().modals[dialog].open).toBe(true)
      expect(log.calls).toEqual(['provisioning.run', 'runtime.getUsersInfo'])
      expect(connectionStatus(store)).toBe('connecting')
    },
  )

  it('never re-enters the provisioning flow from the connect that follows success', async () => {
    runtime.usersInfoAnswers = [REFUSED]
    provisioning.answerSshOn(22)

    await runEndingWith({ kind: 'connected-ready', operation: 'start' })

    expect(log.calls).toEqual(['provisioning.run', 'runtime.getUsersInfo'])
    expect(store.getState().modals['debugger-message'].open).toBe(true)
    expect(slice().view).toEqual(expect.objectContaining({ stage: 'ended' }))
    expect(slice().dialogVisible).toBe(false)
  })

  it.each(ENDINGS_THAT_DISCONNECT)(
    'records a $kind ending and ends disconnected, with no reconnect',
    async (outcome) => {
      await runEndingWith(outcome)

      expect(slice().view).toEqual(
        expect.objectContaining({ stage: 'ended', outcome, acknowledged: false, endedAt: ENDED_AT }),
      )
      expect(connectionStatus(store)).toBe('disconnected')
      expect(log.calls).toEqual(['provisioning.run'])
    },
  )

  it('keeps the output lines with an installer failure', async () => {
    const done = submit()
    await runStarted()
    provisioning.emit({ type: 'output', line: 'Reading package lists...' })
    provisioning.emit({ type: 'output', line: 'E: Unable to locate package docker-ce' })
    provisioning.endRun({ kind: 'installer-failed', lastLines: ['E: Unable to locate package docker-ce'] })
    await done

    expect(slice().view).toEqual(
      expect.objectContaining({
        stage: 'ended',
        outcome: { kind: 'installer-failed', lastLines: ['E: Unable to locate package docker-ce'] },
        lines: ['Reading package lists...', 'E: Unable to locate package docker-ce'],
        acknowledged: false,
      }),
    )
  })
})

describe('closing the project during a run', () => {
  beforeEach(() => {
    showOffer()
  })

  it('stops following through cancel, records unknown and does not reconnect', async () => {
    const done = submit()
    await runStarted()

    store.getState().sharedWorkspaceActions.clearStatesOnCloseProject()
    await settle(() => provisioning.cancelCalls === 1 && !slice().detachRequested)
    provisioning.endRun({ kind: 'unknown' })
    await done
    store.getState().sharedWorkspaceActions.clearStatesOnCloseProject()

    expect(provisioning.cancelCalls).toBe(1)
    expect(slice().view).toEqual(expect.objectContaining({ stage: 'ended', outcome: { kind: 'unknown' } }))
    expect(connectionStatus(store)).toBe('disconnected')
    expect(log.calls).toEqual(['provisioning.run', 'provisioning.cancel'])
    expect(provisioning.runRequests).toHaveLength(1)
    expect(serializedState(store)).not.toContain(SSH_PASSWORD)
  })

  it('stops watching for a project close once the run has returned', async () => {
    const done = submit()
    await runStarted()
    provisioning.endRun({ kind: 'cancelled' })
    await done
    const actions = store.getState().runtimeProvisioningActions
    actions.startRun({ host: DEVICE_IP, sshPort: 22, operationId: 99, startedAt: STARTED_AT })

    actions.requestDetachOnProjectClose()
    await Promise.resolve()
    await Promise.resolve()

    expect(slice().detachRequested).toBe(true)
    expect(provisioning.cancelCalls).toBe(0)
    expect(log.calls).toEqual(['provisioning.run'])
  })
})

describe('consent on every operation', () => {
  it('asks again on the next Connect after a successful start, holding no credentials', async () => {
    runtime.usersInfoAnswers = [REFUSED, { hasUsers: true, runtimeVersion: '4.2.0' }, REFUSED]
    provisioning.answerSshOn(22)
    await connectRuntime(store, ports())
    const done = submit()
    await runStarted()
    provisioning.endRun({ kind: 'connected-ready', operation: 'start' })
    await done
    store.getState().deviceActions.setRuntimeConnectionStatus('disconnected')

    await connectRuntime(store, ports())

    expect(slice().view).toEqual({ stage: 'offer', host: DEVICE_IP, sshPort: 22, notice: null })
    expect(slice().dialogVisible).toBe(true)
    expect(provisioning.runRequests).toHaveLength(1)
    expect(serializedState(store)).not.toContain(SSH_USERNAME)
    expect(serializedState(store)).not.toContain(SSH_PASSWORD)
  })
})
