import { createPlatformPorts } from '@root/frontend/services/__tests__/fixtures/platform-ports'
import {
  boardInfo,
  connectionStatus,
  createCallLog,
  createFakeDevice,
  DEVICE_IP,
  FakeProvisioning,
  FakeRuntime,
  type PortCallLog,
  RUNTIME_V4,
  selectRuntimeTarget,
} from '@root/frontend/services/__tests__/fixtures/runtime-ports'
import type { OpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import type { DevicePort } from '@root/middleware/shared/ports/device-port'
import type {
  RuntimeProvisioningOperation,
  RuntimeProvisioningOutcome,
} from '@root/middleware/shared/ports/runtime-provisioning-port'
import { cleanup, fireEvent, render, within } from '@testing-library/react'

import { Board } from '../board'

const ACTIVITY_TEST_ID = 'device-connect-activity'
const SSH_PORT = 22
const OPERATION_ID = 41
const STARTED_AT = 1_700_000_000_000
const ENDED_AT = 1_700_000_090_000
const CONNECTION_LABELS = ['Connect', 'Connecting...', 'Disconnect']
const FAILURE_LINES = ['Reading package lists...', 'E: Unable to locate package docker-ce']
const INSTALLER_FAILED: RuntimeProvisioningOutcome = { kind: 'installer-failed', lastLines: FAILURE_LINES }
const CONNECTED_READY: RuntimeProvisioningOutcome = { kind: 'connected-ready', operation: 'install' }

let store: OpenPLCStore
let log: PortCallLog
let runtime: FakeRuntime
let provisioning: FakeProvisioning

function provisioningActions() {
  return store.getState().runtimeProvisioningActions
}

function seedRunning(operation: RuntimeProvisioningOperation | null): void {
  const actions = provisioningActions()
  actions.showOffer(DEVICE_IP, SSH_PORT)
  actions.startRun({ host: DEVICE_IP, sshPort: SSH_PORT, operationId: OPERATION_ID, startedAt: STARTED_AT })
  if (operation === 'install') actions.applyEvent({ type: 'phase', phase: 'installing', cancellable: false, operation })
  if (operation === 'start') actions.applyEvent({ type: 'phase', phase: 'starting', cancellable: false, operation })
  actions.setDialogVisible(false)
}

function seedEnded(outcome: RuntimeProvisioningOutcome): void {
  seedRunning('install')
  provisioningActions().finishRun(outcome, ENDED_AT)
  provisioningActions().setDialogVisible(false)
}

function acknowledgeInView(): void {
  store.setState((state) => {
    const { view } = state.runtimeProvisioning
    if (view.stage !== 'ended') return {}
    return { runtimeProvisioning: { ...state.runtimeProvisioning, view: { ...view, acknowledged: true } } }
  })
}

function renderBoard() {
  const device: DevicePort = { ...createFakeDevice(log), getPreviewImage: () => Promise.resolve('') }
  const ports = createPlatformPorts(log, { runtime: runtime.port, device, runtimeProvisioning: provisioning.port })
  return render(<Board />, { wrapper: createStoreWrapper(store, ports) })
}

function runtimeRow(): HTMLElement {
  const row = document.getElementById('runtime-connect-button-container')
  if (row === null) throw new Error('the runtime row is not rendered')
  return row
}

function activityButton(): HTMLElement {
  return within(runtimeRow()).getByTestId(ACTIVITY_TEST_ID)
}

function runtimeButton(): HTMLElement {
  return within(runtimeRow()).getByRole('button')
}

function runningLabel(operation: RuntimeProvisioningOperation | null): string {
  cleanup()
  store = createTestStore()
  selectRuntimeTarget(store, RUNTIME_V4, DEVICE_IP, boardInfo('websocket'))
  seedRunning(operation)
  renderBoard()
  return activityButton().textContent ?? ''
}

function connectAttempts(): string[] {
  return log.calls.filter(
    (call) =>
      call === 'runtime.getUsersInfo' || call === 'provisioning.run' || call.startsWith('provisioning.probeSsh'),
  )
}

describe('Board runtime row during runtime provisioning', () => {
  beforeEach(() => {
    store = createTestStore()
    log = createCallLog()
    runtime = new FakeRuntime(log)
    provisioning = new FakeProvisioning(log)
    selectRuntimeTarget(store, RUNTIME_V4, DEVICE_IP, boardInfo('websocket'))
    store.getState().deviceActions.setRuntimeConnectionStatus('disconnected')
  })

  afterEach(() => {
    cleanup()
  })

  describe('while an operation runs with its dialog hidden', () => {
    it('shows a running install in progress instead of a connection label', () => {
      seedRunning('install')
      renderBoard()

      expect(activityButton().textContent).toMatch(/install/i)
      expect(CONNECTION_LABELS).not.toContain(activityButton().textContent)
    })

    it('shows a running start in progress, worded apart from an install', () => {
      seedRunning('start')
      renderBoard()

      expect(activityButton().textContent).toMatch(/start/i)
      expect(activityButton().textContent).not.toMatch(/install/i)
    })

    it('gives an install, a start and an operation not known yet three labels, none of them a connection label', () => {
      const labels = [runningLabel('install'), runningLabel('start'), runningLabel(null)]

      expect(new Set(labels).size).toBe(3)
      for (const label of labels) expect(CONNECTION_LABELS).not.toContain(label)
    })

    it('keeps the button live while the connection reads connecting', () => {
      seedRunning('install')
      store.getState().deviceActions.setRuntimeConnectionStatus('connecting')
      renderBoard()

      expect(activityButton().hasAttribute('disabled')).toBe(false)
    })

    it('reopens the running operation dialog on a click', () => {
      seedRunning('install')
      renderBoard()

      fireEvent.click(activityButton())

      expect(store.getState().runtimeProvisioning.dialogVisible).toBe(true)
      const { view } = store.getState().runtimeProvisioning
      expect(view.stage === 'running' ? view.operationId : null).toBe(OPERATION_ID)
    })

    it('starts no second operation and no connect on a click', () => {
      seedRunning('install')
      renderBoard()

      fireEvent.click(activityButton())

      expect(connectAttempts()).toEqual([])
      expect(provisioning.runRequests).toEqual([])
      expect(connectionStatus(store)).toBe('disconnected')
    })
  })

  describe('after an operation ended unseen', () => {
    it('offers the result of a failed install instead of showing it in progress', () => {
      seedEnded(INSTALLER_FAILED)
      renderBoard()

      expect(activityButton().textContent).toMatch(/result/i)
      expect(activityButton().textContent).not.toMatch(/install/i)
    })

    it('reopens the ended dialog with its final state on a click', () => {
      seedEnded(INSTALLER_FAILED)
      renderBoard()

      fireEvent.click(activityButton())

      const { view, dialogVisible } = store.getState().runtimeProvisioning
      expect(dialogVisible).toBe(true)
      expect(view.stage === 'ended' ? view.outcome : null).toEqual(INSTALLER_FAILED)
    })

    it('starts no connect when the result is reopened', () => {
      seedEnded(INSTALLER_FAILED)
      renderBoard()

      fireEvent.click(activityButton())

      expect(connectAttempts()).toEqual([])
      expect(connectionStatus(store)).toBe('disconnected')
    })

    it('follows the connection status once a successful install is connected', () => {
      seedEnded(CONNECTED_READY)
      store.getState().deviceActions.setRuntimeConnectionStatus('connected')
      renderBoard()

      expect(within(runtimeRow()).queryByTestId(ACTIVITY_TEST_ID)).toBeNull()
      expect(runtimeButton().textContent).toBe('Disconnect')
    })

    it('shows Connecting... and no activity after a successful install while the connect is under way (TC49)', () => {
      seedEnded(CONNECTED_READY)
      store.getState().deviceActions.setRuntimeConnectionStatus('connecting')
      renderBoard()

      expect(within(runtimeRow()).queryByTestId(ACTIVITY_TEST_ID)).toBeNull()
      expect(runtimeButton().textContent).toBe('Connecting...')
    })

    it('shows Connect and no activity after a successful install once disconnected (TC49)', () => {
      seedEnded(CONNECTED_READY)
      store.getState().deviceActions.setRuntimeConnectionStatus('disconnected')
      renderBoard()

      expect(within(runtimeRow()).queryByTestId(ACTIVITY_TEST_ID)).toBeNull()
      expect(runtimeButton().textContent).toBe('Connect')
    })

    it('still offers Show result for a failed install while disconnected', () => {
      seedEnded(INSTALLER_FAILED)
      store.getState().deviceActions.setRuntimeConnectionStatus('disconnected')
      renderBoard()

      expect(activityButton().textContent).toBe('Show result')
    })

    it('offers nothing once the ending was acknowledged', () => {
      seedEnded(INSTALLER_FAILED)
      acknowledgeInView()
      renderBoard()

      expect(within(runtimeRow()).queryByTestId(ACTIVITY_TEST_ID)).toBeNull()
      expect(runtimeButton().textContent).toBe('Connect')
    })
  })

  describe('with no operation running or ended', () => {
    it('shows Connect with no activity when nothing was provisioned', () => {
      renderBoard()

      expect(within(runtimeRow()).queryByTestId(ACTIVITY_TEST_ID)).toBeNull()
      expect(runtimeButton().textContent).toBe('Connect')
    })

    it('shows Connect with no activity while the offer waits for an answer', () => {
      provisioningActions().showOffer(DEVICE_IP, SSH_PORT)
      provisioningActions().setDialogVisible(false)
      renderBoard()

      expect(within(runtimeRow()).queryByTestId(ACTIVITY_TEST_ID)).toBeNull()
      expect(runtimeButton().textContent).toBe('Connect')
    })
  })
})
