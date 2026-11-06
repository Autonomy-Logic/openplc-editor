import { Board } from '@root/frontend/components/_features/[workspace]/editor/device/configuration/board'
import { createPlatformPorts } from '@root/frontend/services/__tests__/fixtures/platform-ports'
import {
  boardInfo,
  createCallLog,
  createFakeDevice,
  DEVICE_IP,
  FakeProvisioning,
  FakeRuntime,
  type PortCallLog,
  REFUSED,
  RUNTIME_V4,
  selectRuntimeTarget,
} from '@root/frontend/services/__tests__/fixtures/runtime-ports'
import type { OpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import { provisioningMessage } from '@root/frontend/utils/runtime-provisioning-messages'
import type { CompilerPort } from '@root/middleware/shared/ports/compiler-port'
import type { DevicePort } from '@root/middleware/shared/ports/device-port'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { DefaultWorkspaceActivityBar } from '../default'

const SSH_PORT = 22
const OPERATION_ID = 52
const STARTED_AT = 1_700_000_000_000
const ACTIVITY_TEST_ID = 'device-connect-activity'
const SESSION_CANCELLED = 'Debugger session cancelled.'
const DEBUG_COMPILE_STOP = 'stopped by the test after the debug session started'
const OFFER_QUESTION = 'Would you like to connect to OpenPLC Runtime v4 at 192.168.1.50 now?'
const REQUEST_ENDED = provisioningMessage('debugger-request-ended', {})

let store: OpenPLCStore
let log: PortCallLog
let runtime: FakeRuntime
let provisioning: FakeProvisioning
let debugCompiles: string[]

function platformPorts(withProvisioning: boolean): PlatformPorts {
  const device: DevicePort = { ...createFakeDevice(log), getPreviewImage: () => Promise.resolve('') }
  const platform = createPlatformPorts(log, { runtime: runtime.port, device, runtimeProvisioning: provisioning.port })
  const compiler: CompilerPort = {
    ...platform.compiler,
    compileForDebug: (args) => {
      debugCompiles.push(args.boardTarget)
      return Promise.resolve({ success: false, error: DEBUG_COMPILE_STOP })
    },
  }
  return { ...platform, compiler, runtimeProvisioning: withProvisioning ? provisioning.port : undefined }
}

function renderWorkspace(options: { withProvisioning?: boolean; withBoard?: boolean } = {}) {
  store.getState().workspaceActions.setCanEdit(false)
  const wrapper = createStoreWrapper(store, platformPorts(options.withProvisioning ?? true))
  if (options.withBoard) {
    return render(
      <>
        <Board />
        <DefaultWorkspaceActivityBar />
      </>,
      { wrapper },
    )
  }
  return render(<DefaultWorkspaceActivityBar />, { wrapper })
}

function seedRunningInstall(): void {
  const actions = store.getState().runtimeProvisioningActions
  actions.showOffer(DEVICE_IP, SSH_PORT)
  actions.startRun({ host: DEVICE_IP, sshPort: SSH_PORT, operationId: OPERATION_ID, startedAt: STARTED_AT })
  actions.applyEvent({ type: 'phase', phase: 'installing', cancellable: false, operation: 'install' })
  actions.setDialogVisible(false)
}

function debuggerButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Debugger' })
}

/** The open debugger dialog's title and message, or null while none is open. */
function openDebuggerDialog(): { title: string; message: string } | null {
  const { open, data } = store.getState().modalActions.getModalState('debugger-message')
  if (!open || typeof data !== 'object' || data === null) return null
  const title = 'title' in data && typeof data.title === 'string' ? data.title : ''
  const message = 'message' in data && typeof data.message === 'string' ? data.message : ''
  return { title, message }
}

/** Closes the open debugger dialog the way its modal does, then answers it with the given button. */
function answerDebuggerDialog(buttonIndex: number): void {
  const { open, data } = store.getState().modalActions.getModalState('debugger-message')
  if (!open || typeof data !== 'object' || data === null || !('onResponse' in data)) {
    throw new Error('no debugger dialog is open')
  }
  const { onResponse } = data
  if (typeof onResponse !== 'function') throw new Error('the open debugger dialog has no response handler')
  store.getState().modalActions.onOpenChange('debugger-message', false)
  onResponse(buttonIndex)
}

async function acceptNotConnectedOffer(): Promise<void> {
  fireEvent.click(debuggerButton())
  await waitFor(() => expect(openDebuggerDialog()?.title).toBe('Not Connected'))
  expect(debuggerButton().hasAttribute('disabled')).toBe(true)
  answerDebuggerDialog(0)
}

async function waitForRequestToEnd(): Promise<void> {
  await waitFor(() => expect(debuggerButton().hasAttribute('disabled')).toBe(false))
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 50; turn += 1) await Promise.resolve()
  })
}

function requestEndedLines() {
  return store
    .getState()
    .logs.filter((entry) => entry.message.includes(REQUEST_ENDED.body) || entry.message.includes(REQUEST_ENDED.title))
}

function cancelledLines() {
  return store.getState().logs.filter((entry) => entry.message === SESSION_CANCELLED)
}

function connectAttempts(): string[] {
  return log.calls.filter(
    (call) =>
      call === 'runtime.getUsersInfo' ||
      call === 'bootloader.getCapabilities' ||
      call === 'provisioning.run' ||
      call.startsWith('provisioning.probeSsh'),
  )
}

function establishRuntimeSession(): void {
  act(() => {
    store.getState().deviceActions.setDeviceConnectionStatus('connected')
    store.getState().deviceActions.setRuntimeConnectionStatus('connected')
  })
}

describe('debugger offer and runtime provisioning', () => {
  beforeEach(() => {
    store = createTestStore()
    log = createCallLog()
    runtime = new FakeRuntime(log)
    provisioning = new FakeProvisioning(log)
    debugCompiles = []
    selectRuntimeTarget(store, RUNTIME_V4, DEVICE_IP, boardInfo('websocket'))
  })

  afterEach(() => {
    cleanup()
  })

  describe('when no runtime answers and SSH does', () => {
    beforeEach(() => {
      runtime.usersInfoAnswers = [REFUSED]
      provisioning.answerSshOn(SSH_PORT)
    })

    it('names the runtime in the offer and opens the install-or-start offer after Yes', async () => {
      renderWorkspace()
      fireEvent.click(debuggerButton())
      await waitFor(() => expect(openDebuggerDialog()?.message).toContain(OFFER_QUESTION))

      answerDebuggerDialog(0)

      await waitFor(() => expect(store.getState().runtimeProvisioning.view.stage).toBe('offer'))
      expect(store.getState().runtimeProvisioning.dialogVisible).toBe(true)
    })

    it('ends the debugger request at once, leaving the Debugger button live', async () => {
      renderWorkspace()

      await acceptNotConnectedOffer()

      await waitForRequestToEnd()
    })

    it('writes exactly one info line to the console saying the debugger request ended', async () => {
      renderWorkspace()
      await acceptNotConnectedOffer()
      await waitForRequestToEnd()

      const lines = requestEndedLines().map((entry) => [entry.level, entry.message.includes(REQUEST_ENDED.body)])

      expect(lines).toEqual([['info', true]])
    })

    it('does not report the request as a cancelled debugger session', async () => {
      renderWorkspace()
      await acceptNotConnectedOffer()
      await waitForRequestToEnd()

      expect(cancelledLines()).toEqual([])
    })

    it('shows no debugger dialog for the end of the request', async () => {
      renderWorkspace()
      await acceptNotConnectedOffer()
      await waitForRequestToEnd()

      expect(openDebuggerDialog()).toBeNull()
    })

    it('does not start a debug session when the runtime connects after the request ended', async () => {
      renderWorkspace()
      await acceptNotConnectedOffer()
      await waitForRequestToEnd()

      establishRuntimeSession()
      await flushMicrotasks()

      expect(debugCompiles).toEqual([])
    })
  })

  describe('while an install runs with its dialog hidden', () => {
    beforeEach(() => {
      seedRunningInstall()
    })

    it('reopens the running operation dialog after Yes', async () => {
      renderWorkspace()
      await acceptNotConnectedOffer()
      await waitForRequestToEnd()

      const { view, dialogVisible } = store.getState().runtimeProvisioning
      expect(dialogVisible).toBe(true)
      expect(view.stage === 'running' ? view.operationId : null).toBe(OPERATION_ID)
    })

    it('starts no second operation and opens no second SSH check', async () => {
      renderWorkspace()
      await acceptNotConnectedOffer()
      await waitForRequestToEnd()

      expect(connectAttempts()).toEqual([])
      expect(provisioning.runRequests).toEqual([])
    })

    it('ends the debugger request with exactly one console line and no cancelled session', async () => {
      renderWorkspace()
      await acceptNotConnectedOffer()
      await waitForRequestToEnd()

      expect(requestEndedLines()).toHaveLength(1)
      expect(cancelledLines()).toEqual([])
    })

    it('reopens the operation from Connect and then from the debugger offer, sending no run either time', async () => {
      renderWorkspace({ withBoard: true })

      fireEvent.click(screen.getByTestId(ACTIVITY_TEST_ID))
      expect(store.getState().runtimeProvisioning.dialogVisible).toBe(true)
      act(() => store.getState().runtimeProvisioningActions.setDialogVisible(false))

      await acceptNotConnectedOffer()
      await waitForRequestToEnd()

      expect(store.getState().runtimeProvisioning.dialogVisible).toBe(true)
      expect(connectAttempts()).toEqual([])
      expect(provisioning.runRequests).toEqual([])
    })
  })

  describe('when the runtime answers', () => {
    beforeEach(() => {
      runtime.usersInfoAnswers = [{ hasUsers: true, runtimeVersion: '4.2.0' }]
    })

    it('opens the runtime login after Yes and makes no bootloader or SSH check', async () => {
      renderWorkspace()
      await acceptNotConnectedOffer()

      await waitFor(() => expect(store.getState().modalActions.getModalState('runtime-login').open).toBe(true))
      expect(connectAttempts()).toEqual(['runtime.getUsersInfo'])
    })

    it('starts the debug session once the login is done, with no request-ended line', async () => {
      renderWorkspace()
      await acceptNotConnectedOffer()
      await waitFor(() => expect(store.getState().modalActions.getModalState('runtime-login').open).toBe(true))

      establishRuntimeSession()

      await waitFor(() => expect(debugCompiles).toEqual([RUNTIME_V4]))
      expect(requestEndedLines()).toEqual([])
    })

    it('logs one cancelled session when the login is abandoned, as today', async () => {
      renderWorkspace()
      await acceptNotConnectedOffer()
      await waitFor(() => expect(store.getState().modalActions.getModalState('runtime-login').open).toBe(true))

      act(() => store.getState().deviceActions.setRuntimeConnectionStatus('disconnected'))
      await waitForRequestToEnd()

      expect(cancelledLines()).toHaveLength(1)
      expect(requestEndedLines()).toEqual([])
    })
  })

  describe('with a runtime session already open', () => {
    it('starts the debug session without asking to connect', async () => {
      store.getState().deviceActions.setDeviceConnectionStatus('connected')
      store.getState().deviceActions.setRuntimeConnectionStatus('connected')
      renderWorkspace()

      fireEvent.click(debuggerButton())

      await waitFor(() => expect(debugCompiles).toEqual([RUNTIME_V4]))
      expect(openDebuggerDialog()).toBeNull()
      expect(connectAttempts()).toEqual([])
    })
  })

  describe('without the provisioning port, as on the web', () => {
    it('keeps the failed connect path: the No Response dialog and no request-ended line', async () => {
      runtime.usersInfoAnswers = [REFUSED]
      provisioning.answerSshOn(SSH_PORT)
      renderWorkspace({ withProvisioning: false })

      await acceptNotConnectedOffer()
      await waitForRequestToEnd()

      expect(openDebuggerDialog()?.title).toBe('No Response')
      expect(requestEndedLines()).toEqual([])
      expect(connectAttempts()).toEqual(['runtime.getUsersInfo'])
    })
  })
})
