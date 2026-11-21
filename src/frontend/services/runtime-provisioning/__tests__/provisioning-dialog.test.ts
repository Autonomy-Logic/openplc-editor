import type { DevicePort } from '../../../../middleware/shared/ports/device-port'
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
  settle,
  SSH_PASSWORD,
  SSH_USERNAME,
  unexpectedCalls,
} from '../../__tests__/fixtures/runtime-ports'
import { connectRuntime } from '../../runtime-connect'
import {
  cancelProvisioning,
  declineProvisioningOffer,
  hideProvisioningDialog,
  reopenProvisioningDialog,
  retryWithSshPort,
  submitProvisioningRun,
} from '..'

let store: OpenPLCStore
let log: PortCallLog
let runtime: FakeRuntime
let provisioning: FakeProvisioning
let device: DevicePort

function ports() {
  return { runtime: runtime.port, device, runtimeProvisioning: provisioning.port }
}

function slice() {
  return store.getState().runtimeProvisioning
}

function noDeviceModal() {
  return store.getState().modals['runtime-no-device']
}

function startRunning(cancellable: boolean): void {
  const actions = store.getState().runtimeProvisioningActions
  actions.showOffer(DEVICE_IP, 22)
  actions.startRun({ host: DEVICE_IP, sshPort: 22, operationId: 3, startedAt: 1_700_000_000_000 })
  actions.applyEvent({ type: 'phase', phase: 'inspecting', cancellable })
}

beforeEach(() => {
  store = createTestStore()
  log = createCallLog()
  runtime = new FakeRuntime(log)
  provisioning = new FakeProvisioning(log)
  device = createFakeDevice(log)
  selectRuntimeTarget(store, RUNTIME_V4, DEVICE_IP)
})

afterEach(() => {
  expect(unexpectedCalls(log)).toEqual([])
})

describe('retryWithSshPort', () => {
  beforeEach(() => {
    store.getState().modalActions.openModal('runtime-no-device', { host: DEVICE_IP, sshPort: 22 })
  })

  it('remembers a port that answers, closes the no-device message and offers on that port', async () => {
    provisioning.answerSshOn(2222)

    await retryWithSshPort(store, ports(), DEVICE_IP, 2222)

    expect(provisioning.probeRequests).toEqual([{ host: DEVICE_IP, port: 2222 }])
    expect(slice().sessionSshPorts).toEqual({ [DEVICE_IP]: 2222 })
    expect(noDeviceModal().open).toBe(false)
    expect(slice().view).toEqual({ stage: 'offer', host: DEVICE_IP, sshPort: 2222, notice: null })
    expect(slice().dialogVisible).toBe(true)
    expect(connectionStatus(store)).toBe('disconnected')
    expect(log.calls).toEqual([`provisioning.probeSsh ${DEVICE_IP}:2222`])
  })

  it('shows the no-device message again for a port that does not answer, remembering nothing', async () => {
    await retryWithSshPort(store, ports(), DEVICE_IP, 2222)

    expect(noDeviceModal()).toEqual({ open: true, data: { host: DEVICE_IP, sshPort: 2222 } })
    expect(slice().sessionSshPorts).toEqual({})
    expect(slice().view).toEqual({ stage: 'idle' })
    expect(connectionStatus(store)).toBe('disconnected')
    expect(log.calls).toEqual([`provisioning.probeSsh ${DEVICE_IP}:2222`])
  })
})

describe('trying another SSH port across the session', () => {
  it('checks, offers and logs in on the entered port, and checks it again on the next Connect', async () => {
    runtime.usersInfoAnswers = [REFUSED]
    provisioning.answerSshOn(2222)

    await connectRuntime(store, ports())
    const firstMessage = noDeviceModal()
    await retryWithSshPort(store, ports(), DEVICE_IP, 2222)
    const offered = slice().view
    const run = submitProvisioningRun(store, ports(), {
      username: SSH_USERNAME,
      password: SSH_PASSWORD,
      sshPort: 2222,
    })
    await settle(() => provisioning.pendingRunCount === 1)
    provisioning.endRun({ kind: 'cancelled' })
    await run
    await connectRuntime(store, ports())
    declineProvisioningOffer(store)
    await connectRuntime(store, ports())

    expect(firstMessage).toEqual({ open: true, data: { host: DEVICE_IP, sshPort: 22 } })
    expect(offered).toEqual({ stage: 'offer', host: DEVICE_IP, sshPort: 2222, notice: null })
    expect(provisioning.runRequests.map(({ port }) => port)).toEqual([2222])
    expect(provisioning.probeRequests.map(({ port }) => port)).toEqual([22, 2222, 2222, 2222])
    expect(JSON.stringify(store.getState().deviceDefinitions)).not.toContain('2222')
    expect(JSON.stringify(store.getState().project)).not.toContain('2222')
  })
})

describe('cancelProvisioning', () => {
  it('declines a pending offer without contacting the device', async () => {
    store.getState().runtimeProvisioningActions.showOffer(DEVICE_IP, 22)

    await cancelProvisioning(store, provisioning.port)

    expect(slice().view).toEqual({ stage: 'idle' })
    expect(slice().dialogVisible).toBe(false)
    expect(connectionStatus(store)).toBe('disconnected')
    expect(log.calls).toEqual([])
  })

  it('asks the device side to cancel a run that can be cancelled', async () => {
    startRunning(true)

    await cancelProvisioning(store, provisioning.port)

    expect(provisioning.cancelCalls).toBe(1)
  })

  it('does not cancel a run past the point where it can be cancelled', async () => {
    startRunning(false)

    await cancelProvisioning(store, provisioning.port)

    expect(provisioning.cancelCalls).toBe(0)
    expect(slice().view).toEqual(expect.objectContaining({ stage: 'running' }))
  })

  it('does nothing when no operation is open', async () => {
    await cancelProvisioning(store, provisioning.port)

    expect(slice().view).toEqual({ stage: 'idle' })
    expect(log.calls).toEqual([])
  })
})

describe('the dialog visibility', () => {
  it('hides and reopens the dialog of a running operation without changing it', () => {
    startRunning(true)
    const view = slice().view

    hideProvisioningDialog(store)
    const hidden = slice().dialogVisible
    reopenProvisioningDialog(store)

    expect(hidden).toBe(false)
    expect(slice().dialogVisible).toBe(true)
    expect(slice().view).toEqual(view)
  })
})

describe('declineProvisioningOffer', () => {
  it('closes the offer, leaves the device untouched and ends disconnected', async () => {
    runtime.usersInfoAnswers = [REFUSED]
    provisioning.answerSshOn(22)
    await connectRuntime(store, ports())
    const callsBeforeDecline = log.calls.length

    declineProvisioningOffer(store)

    expect(slice().view).toEqual({ stage: 'idle' })
    expect(slice().dialogVisible).toBe(false)
    expect(connectionStatus(store)).toBe('disconnected')
    expect(log.calls).toHaveLength(callsBeforeDecline)
    expect(provisioning.runRequests).toEqual([])
  })
})
