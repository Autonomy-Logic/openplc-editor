import type { DevicePort } from '../../../middleware/shared/ports/device-port'
import type { RuntimeConnectFailureKind, UsersInfoResult } from '../../../middleware/shared/ports/runtime-port'
import type { BoardInfo } from '../../../middleware/shared/ports/types'
import type { OpenPLCStore } from '../../store'
import type { ConnectionStatus, SelectedDevice } from '../../store/slices/device/types'
import { createTestStore } from '../../store/testing'
import { connectRuntime, isProvisioningTarget } from '../runtime-connect'
import {
  boardInfo,
  BOOTLOADER_SILENT,
  bootloaderReports,
  connectionStatus,
  createCallLog,
  createFakeDevice,
  DEVICE_IP,
  FakeProvisioning,
  FakeRuntime,
  modalText,
  type PortCallLog,
  REFUSED,
  RUNTIME_V4,
  selectRuntimeTarget,
  unexpectedCalls,
} from './fixtures/runtime-ports'

type SessionDialog = 'runtime-login' | 'runtime-create-user'

const PROVISIONING_TARGETS: [string, string, BoardInfo | undefined][] = [
  ['OpenPLC Runtime v4 with its board info', RUNTIME_V4, boardInfo('websocket')],
  ['OpenPLC Runtime v4 known only by name', RUNTIME_V4, undefined],
  ['a vendor board whose debugger transport is websocket', 'Acme EdgeBox 200', boardInfo('websocket')],
]

const OTHER_TARGETS: [string, string, BoardInfo | undefined][] = [
  ['OpenPLC Runtime v3 with its board info', 'OpenPLC Runtime v3', boardInfo('modbus-tcp')],
  ['OpenPLC Runtime v3 known only by name', 'OpenPLC Runtime v3', undefined],
  ['an Ethernet-upload board such as LOGO! 8.2', 'LOGO! 8.2', boardInfo('modbus-tcp', 'ethernet')],
  ['a websocket board programmed by Ethernet upload', 'Acme Ethernet Loader', boardInfo('websocket', 'ethernet')],
]

const BOARDS_WITHOUT_OFFER: [string, BoardInfo][] = [
  ['OpenPLC Runtime v3', boardInfo('modbus-tcp')],
  ['LOGO! 8.2', boardInfo('modbus-tcp', 'ethernet')],
  ['Acme Ethernet Loader', boardInfo('websocket', 'ethernet')],
]

const ANSWERING_RUNTIMES: [string, UsersInfoResult, SessionDialog][] = [
  ['a runtime with accounts', { hasUsers: true, runtimeVersion: '4.2.0' }, 'runtime-login'],
  ['a fresh runtime', { hasUsers: false, runtimeVersion: '4.2.0' }, 'runtime-create-user'],
  [
    'an HTTP 404 with an HTML body, read as no accounts',
    { hasUsers: false, runtimeVersion: '4.2.0' },
    'runtime-create-user',
  ],
  [
    'an HTTP 200 whose body is not JSON, read as accounts',
    { hasUsers: true, runtimeVersion: '4.2.0' },
    'runtime-login',
  ],
]

const NOTHING_TO_START: ConnectionStatus[] = ['connected', 'connecting']

const CHECKED_FAILURES: RuntimeConnectFailureKind[] = ['refused', 'timeout', 'host-unreachable', 'network-unreachable']

const UNCHECKED_FAILURES: [string, string, UsersInfoResult][] = [
  ['HTTP 500', DEVICE_IP, { hasUsers: false, error: 'Unexpected status: 500' }],
  ['HTTP 401', DEVICE_IP, { hasUsers: false, error: 'Unexpected status: 401' }],
  ['HTTP 403', DEVICE_IP, { hasUsers: false, error: 'Unexpected status: 403' }],
  ['ECONNRESET', DEVICE_IP, { hasUsers: false, error: 'read ECONNRESET', failure: 'other' }],
  [
    'a TLS handshake failure',
    DEVICE_IP,
    {
      hasUsers: false,
      error: 'Client network socket disconnected before secure TLS connection was established',
      failure: 'other',
    },
  ],
  [
    'a name that does not resolve',
    'plc-missing.local',
    { hasUsers: false, error: 'getaddrinfo ENOTFOUND plc-missing.local', failure: 'other' },
  ],
  ['a failure with no kind', DEVICE_IP, { hasUsers: false, error: 'socket hang up' }],
]

const SELECTED: SelectedDevice = {
  orchestratorId: 'orch-1',
  orchestratorAgentId: 'agent-1',
  deviceId: 'dev-9',
  deviceName: 'Line A',
}

let store: OpenPLCStore
let log: PortCallLog
let runtime: FakeRuntime
let provisioning: FakeProvisioning
let device: DevicePort

function desktopPorts() {
  return { runtime: runtime.port, device, runtimeProvisioning: provisioning.port }
}

function noResponse(target: string, reason: string): string {
  return `Could not reach ${target}: ${reason}. Check that it is powered and on the network, and that the IP address is correct.`
}

function isOpen(modal: 'runtime-login' | 'runtime-create-user' | 'debugger-message' | 'runtime-no-device'): boolean {
  return store.getState().modals[modal].open
}

function debuggerMessage(): string {
  return modalText(store.getState().modals['debugger-message'].data)
}

function provisioningChecks(): string[] {
  return log.calls.filter((call) => call.startsWith('bootloader.') || call.startsWith('provisioning.'))
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

describe('isProvisioningTarget', () => {
  it.each(PROVISIONING_TARGETS)('is true for %s', (_name, board, info) => {
    expect(isProvisioningTarget(board, info)).toBe(true)
  })

  it.each(OTHER_TARGETS)('is false for %s', (_name, board, info) => {
    expect(isProvisioningTarget(board, info)).toBe(false)
  })
})

describe('connectRuntime when the runtime answers on 8443', () => {
  it.each(ANSWERING_RUNTIMES)(
    'opens the session dialog for %s, with no provisioning check',
    async (_name, answer, dialog) => {
      runtime.usersInfoAnswers = [answer]

      const outcome = await connectRuntime(store, desktopPorts())

      expect(outcome).toBe('session-pending')
      expect(isOpen(dialog)).toBe(true)
      expect(connectionStatus(store)).toBe('connecting')
      expect(log.calls).toEqual(['runtime.getUsersInfo'])
      expect(store.getState().runtimeProvisioning.view).toEqual({ stage: 'idle' })
      expect(store.getState().runtimeProvisioning.dialogVisible).toBe(false)
    },
  )

  it('remembers the runtime version for the session', async () => {
    await connectRuntime(store, desktopPorts())

    expect(store.getState().runtimeConnection.runtimeVersion).toBe('4.2.0')
  })

  it('refuses a runtime whose major version does not match the target', async () => {
    runtime.usersInfoAnswers = [{ hasUsers: true, runtimeVersion: '3.0.0' }]

    const outcome = await connectRuntime(store, desktopPorts())

    expect(outcome).toBe('failed')
    expect(connectionStatus(store)).toBe('error')
    expect(debuggerMessage()).toContain('Runtime Version Mismatch')
    expect(isOpen('runtime-login')).toBe(false)
  })

  it('reports a thrown users-info call as today, with no provisioning check', async () => {
    runtime.usersInfoAnswers = [new Error('boom')]

    const outcome = await connectRuntime(store, desktopPorts())

    expect(outcome).toBe('failed')
    expect(connectionStatus(store)).toBe('error')
    expect(store.getState().modals['debugger-message'].data).toEqual(
      expect.objectContaining({ title: 'No Response', message: noResponse(`${RUNTIME_V4} at ${DEVICE_IP}`, 'boom') }),
    )
    expect(provisioningChecks()).toEqual([])
  })
})

describe('connectRuntime when there is nothing to start', () => {
  it.each(NOTHING_TO_START)('does nothing when the status is %s', async (status) => {
    store.getState().deviceActions.setRuntimeConnectionStatus(status)

    const outcome = await connectRuntime(store, desktopPorts())

    expect(outcome).toBe('noop')
    expect(log.calls).toEqual([])
  })

  it('stops when there is neither an address nor a selected device', async () => {
    store.getState().deviceActions.setRuntimeIpAddress('')

    await connectRuntime(store, desktopPorts())

    expect(log.calls).toEqual([])
    expect(connectionStatus(store)).toBe('disconnected')
  })
})

describe('connectRuntime with an orchestrator device', () => {
  beforeEach(() => {
    store.getState().deviceActions.setSelectedDevice(SELECTED)
    runtime.usersInfoAnswers = [REFUSED]
    provisioning.answerSshOn(22)
  })

  it('addresses the selected device before asking the runtime', async () => {
    runtime.usersInfoAnswers = [{ hasUsers: true, runtimeVersion: '4.2.0' }]

    await connectRuntime(store, desktopPorts())

    expect(runtime.deviceContexts).toEqual([{ agentId: 'agent-1', deviceId: 'dev-9' }])
    expect(log.calls).toEqual(['runtime.setDeviceContext', 'runtime.getUsersInfo'])
  })

  it('keeps the unreachable report and makes no provisioning check when no address is set', async () => {
    store.getState().deviceActions.setRuntimeIpAddress('')

    const outcome = await connectRuntime(store, desktopPorts())

    expect(outcome).toBe('failed')
    expect(connectionStatus(store)).toBe('error')
    expect(store.getState().modals['debugger-message'].data).toEqual(
      expect.objectContaining({ title: 'No Response', message: noResponse('"Line A"', REFUSED.error ?? '') }),
    )
    expect(provisioningChecks()).toEqual([])
  })

  it('makes no provisioning check even when an address is also set', async () => {
    const outcome = await connectRuntime(store, desktopPorts())

    expect(outcome).toBe('failed')
    expect(provisioningChecks()).toEqual([])
    expect(store.getState().runtimeProvisioning.view).toEqual({ stage: 'idle' })
  })
})

describe('which connect failures start the provisioning checks', () => {
  beforeEach(() => {
    provisioning.answerSshOn(22)
  })

  it.each(CHECKED_FAILURES)(
    'a %s failure asks the bootloader with a 2,500 ms limit, then checks SSH on port 22',
    async (failure) => {
      runtime.usersInfoAnswers = [{ hasUsers: false, error: 'no answer from 192.168.1.50:8443', failure }]

      const outcome = await connectRuntime(store, desktopPorts())

      expect(outcome).toBe('provisioning-flow')
      expect(log.calls).toEqual([
        'runtime.getUsersInfo',
        'bootloader.getCapabilities',
        `provisioning.probeSsh ${DEVICE_IP}:22`,
      ])
      expect(runtime.capabilitiesOptions).toEqual([{ timeoutMs: 2500 }])
      expect(provisioning.probeRequests).toEqual([{ host: DEVICE_IP, port: 22 }])
      expect(isOpen('debugger-message')).toBe(false)
    },
  )

  it.each(UNCHECKED_FAILURES)(
    '%s keeps the No Response report and makes no provisioning check',
    async (_name, address, answer) => {
      store.getState().deviceActions.setRuntimeIpAddress(address)
      runtime.usersInfoAnswers = [answer]

      const outcome = await connectRuntime(store, desktopPorts())

      expect(outcome).toBe('failed')
      expect(connectionStatus(store)).toBe('error')
      expect(store.getState().modals['debugger-message']).toEqual({
        open: true,
        data: expect.objectContaining({
          type: 'error',
          title: 'No Response',
          message: noResponse(`${RUNTIME_V4} at ${address}`, answer.error ?? ''),
          buttons: ['OK'],
        }),
      })
      expect(log.calls).toEqual(['runtime.getUsersInfo'])
      expect(store.getState().runtimeProvisioning.view).toEqual({ stage: 'idle' })
    },
  )
})

describe('when the provisioning flow is not available', () => {
  beforeEach(() => {
    runtime.usersInfoAnswers = [REFUSED]
    provisioning.answerSshOn(22)
  })

  it('keeps the current connect when the provisioning port is absent, as on the web', async () => {
    const outcome = await connectRuntime(store, { runtime: runtime.port, device })

    expect(outcome).toBe('failed')
    expect(connectionStatus(store)).toBe('error')
    expect(store.getState().modals['debugger-message'].data).toEqual(
      expect.objectContaining({
        title: 'No Response',
        message: noResponse(`${RUNTIME_V4} at ${DEVICE_IP}`, REFUSED.error ?? ''),
      }),
    )
    expect(runtime.capabilitiesOptions).toEqual([])
    expect(log.calls).toEqual(['runtime.getUsersInfo'])
    expect(store.getState().runtimeProvisioning.dialogVisible).toBe(false)
  })

  it('keeps the current connect when the caller disallows the flow', async () => {
    const outcome = await connectRuntime(store, desktopPorts(), { allowProvisioningFlow: false })

    expect(outcome).toBe('failed')
    expect(isOpen('debugger-message')).toBe(true)
    expect(log.calls).toEqual(['runtime.getUsersInfo'])
  })

  it('offers the flow for a vendor board whose debugger transport is websocket', async () => {
    selectRuntimeTarget(store, 'Acme EdgeBox 200', DEVICE_IP, boardInfo('websocket'))

    const outcome = await connectRuntime(store, desktopPorts())

    expect(outcome).toBe('provisioning-flow')
    expect(store.getState().runtimeProvisioning.view).toEqual({
      stage: 'offer',
      host: DEVICE_IP,
      sshPort: 22,
      notice: null,
    })
  })

  it.each(BOARDS_WITHOUT_OFFER)(
    'keeps the current failure for %s, with no bootloader or SSH check',
    async (board, info) => {
      selectRuntimeTarget(store, board, DEVICE_IP, info)

      const outcome = await connectRuntime(store, desktopPorts())

      expect(outcome).toBe('failed')
      expect(connectionStatus(store)).toBe('error')
      expect(store.getState().modals['debugger-message'].data).toEqual(
        expect.objectContaining({ message: noResponse(`${board} at ${DEVICE_IP}`, REFUSED.error ?? '') }),
      )
      expect(log.calls).toEqual(['runtime.getUsersInfo'])
      expect(store.getState().runtimeProvisioning.view).toEqual({ stage: 'idle' })
    },
  )
})

describe('the provisioning checks', () => {
  beforeEach(() => {
    runtime.usersInfoAnswers = [REFUSED]
  })

  it('keeps the status connecting during the checks and ends disconnected', async () => {
    const seen: string[] = []
    log.onCall = (member) => seen.push(`${member} while ${connectionStatus(store)}`)
    provisioning.answerSshOn(22)

    await connectRuntime(store, desktopPorts())

    expect(seen).toEqual([
      'runtime.getUsersInfo while connecting',
      'bootloader.getCapabilities while connecting',
      `provisioning.probeSsh ${DEVICE_IP}:22 while connecting`,
    ])
    expect(connectionStatus(store)).toBe('disconnected')
  })

  it('reports no recognized device when neither the runtime, the bootloader nor SSH answers', async () => {
    store.getState().deviceActions.setRuntimeIpAddress('192.0.2.10')
    runtime.usersInfoAnswers = [{ hasUsers: false, error: 'timeout of 5000ms exceeded', failure: 'timeout' }]

    const outcome = await connectRuntime(store, desktopPorts())

    expect(outcome).toBe('provisioning-flow')
    expect(store.getState().modals['runtime-no-device']).toEqual({
      open: true,
      data: { host: '192.0.2.10', sshPort: 22 },
    })
    expect(runtime.capabilitiesOptions).toEqual([{ timeoutMs: 2500 }])
    expect(provisioning.runRequests).toEqual([])
    expect(connectionStatus(store)).toBe('disconnected')
    expect(isOpen('debugger-message')).toBe(false)
    expect(store.getState().runtimeProvisioning.view).toEqual({ stage: 'idle' })
  })

  it('offers to install or start the runtime when SSH answers', async () => {
    provisioning.answerSshOn(22)

    const outcome = await connectRuntime(store, desktopPorts())

    expect(outcome).toBe('provisioning-flow')
    expect(store.getState().runtimeProvisioning.view).toEqual({
      stage: 'offer',
      host: DEVICE_IP,
      sshPort: 22,
      notice: null,
    })
    expect(store.getState().runtimeProvisioning.dialogVisible).toBe(true)
    expect(isOpen('runtime-login')).toBe(false)
    expect(isOpen('runtime-create-user')).toBe(false)
    expect(isOpen('runtime-no-device')).toBe(false)
    expect(isOpen('debugger-message')).toBe(false)
    expect(provisioning.runRequests).toEqual([])
    expect(connectionStatus(store)).toBe('disconnected')
  })

  it('reports recovery with the bootloader state and makes no SSH check', async () => {
    runtime.bootloaderAnswer = bootloaderReports('recovery', true)
    provisioning.answerSshOn(22)

    const outcome = await connectRuntime(store, desktopPorts())

    expect(outcome).toBe('provisioning-flow')
    expect(isOpen('debugger-message')).toBe(true)
    expect(debuggerMessage()).toMatch(/installed/i)
    expect(debuggerMessage()).toMatch(/failed to start/i)
    expect(debuggerMessage()).toContain('recovery')
    expect(provisioning.probeRequests).toEqual([])
    expect(store.getState().runtimeProvisioning.view).toEqual({ stage: 'idle' })
    expect(isOpen('runtime-login')).toBe(false)
    expect(isOpen('runtime-create-user')).toBe(false)
    expect(connectionStatus(store)).toBe('disconnected')
  })

  it('gives recovery precedence over an SSH server that answers, after a timeout', async () => {
    runtime.usersInfoAnswers = [{ hasUsers: false, error: 'timeout of 5000ms exceeded', failure: 'timeout' }]
    runtime.bootloaderAnswer = bootloaderReports('healthy', true)
    provisioning.answerSshOn(22)

    await connectRuntime(store, desktopPorts())

    expect(debuggerMessage()).toMatch(/failed to start/i)
    expect(debuggerMessage()).toContain('healthy')
    expect(provisioning.probeRequests).toEqual([])
    expect(store.getState().runtimeProvisioning.dialogVisible).toBe(false)
  })

  it.each(['starting', 'updating', 'booting', 'pulling'])(
    'reports a bootloader that is %s as busy and makes no SSH check',
    async (state) => {
      runtime.bootloaderAnswer = bootloaderReports(state, false)
      provisioning.answerSshOn(22)

      const outcome = await connectRuntime(store, desktopPorts())

      expect(outcome).toBe('provisioning-flow')
      expect(debuggerMessage()).toContain(state)
      expect(debuggerMessage()).toMatch(/try again later/i)
      expect(provisioning.probeRequests).toEqual([])
      expect(store.getState().runtimeProvisioning.view).toEqual({ stage: 'idle' })
      expect(connectionStatus(store)).toBe('disconnected')
    },
  )

  it('checks SSH when the bootloader is healthy and offers when SSH answers', async () => {
    runtime.bootloaderAnswer = bootloaderReports('healthy', false)
    provisioning.answerSshOn(22)

    await connectRuntime(store, desktopPorts())

    expect(provisioning.probeRequests).toEqual([{ host: DEVICE_IP, port: 22 }])
    expect(store.getState().runtimeProvisioning.view).toEqual(
      expect.objectContaining({ stage: 'offer', host: DEVICE_IP, sshPort: 22 }),
    )
  })

  it('checks the SSH port remembered for the host in this session', async () => {
    store.getState().runtimeProvisioningActions.rememberSshPort(DEVICE_IP, 2222)
    provisioning.answerSshOn(2222)

    await connectRuntime(store, desktopPorts())

    expect(provisioning.probeRequests).toEqual([{ host: DEVICE_IP, port: 2222 }])
    expect(store.getState().runtimeProvisioning.view).toEqual(
      expect.objectContaining({ stage: 'offer', host: DEVICE_IP, sshPort: 2222 }),
    )
  })

  it('names the remembered port when SSH does not answer on it', async () => {
    store.getState().runtimeProvisioningActions.rememberSshPort(DEVICE_IP, 2222)

    await connectRuntime(store, desktopPorts())

    expect(store.getState().modals['runtime-no-device'].data).toEqual({ host: DEVICE_IP, sshPort: 2222 })
  })

  it('uses port 22 for a host with no remembered port', async () => {
    store.getState().runtimeProvisioningActions.rememberSshPort('192.168.1.99', 2222)
    provisioning.answerSshOn(22)

    await connectRuntime(store, desktopPorts())

    expect(provisioning.probeRequests).toEqual([{ host: DEVICE_IP, port: 22 }])
  })

  it('treats a bootloader that does not answer as a reason to check SSH', async () => {
    runtime.bootloaderAnswer = BOOTLOADER_SILENT
    provisioning.answerSshOn(22)

    await connectRuntime(store, desktopPorts())

    expect(provisioning.probeRequests).toEqual([{ host: DEVICE_IP, port: 22 }])
  })
})

describe('connectRuntime while a provisioning operation is open', () => {
  function startRunningOperation(): void {
    const actions = store.getState().runtimeProvisioningActions
    actions.showOffer(DEVICE_IP, 22)
    actions.startRun({ host: DEVICE_IP, sshPort: 22, operationId: 1, startedAt: 1_700_000_000_000 })
    actions.setDialogVisible(false)
  }

  it('reopens the running operation dialog without contacting the device', async () => {
    startRunningOperation()

    const outcome = await connectRuntime(store, desktopPorts())

    expect(outcome).toBe('provisioning-flow')
    expect(store.getState().runtimeProvisioning.dialogVisible).toBe(true)
    expect(store.getState().runtimeProvisioning.view).toEqual(expect.objectContaining({ stage: 'running' }))
    expect(log.calls).toEqual([])
  })

  it('reopens the dialog on every Connect and never starts a second operation', async () => {
    startRunningOperation()

    await connectRuntime(store, desktopPorts())
    const firstReopen = store.getState().runtimeProvisioning.dialogVisible
    store.getState().runtimeProvisioningActions.setDialogVisible(false)
    await connectRuntime(store, desktopPorts())

    expect(firstReopen).toBe(true)
    expect(store.getState().runtimeProvisioning.dialogVisible).toBe(true)
    expect(provisioning.runRequests).toEqual([])
    expect(log.calls).toEqual([])
  })

  it('reopens a pending offer without contacting the device', async () => {
    store.getState().runtimeProvisioningActions.showOffer(DEVICE_IP, 22)
    store.getState().runtimeProvisioningActions.setDialogVisible(false)

    const outcome = await connectRuntime(store, desktopPorts())

    expect(outcome).toBe('provisioning-flow')
    expect(store.getState().runtimeProvisioning.dialogVisible).toBe(true)
    expect(log.calls).toEqual([])
  })

  it('connects as usual once the operation has ended', async () => {
    startRunningOperation()
    store.getState().runtimeProvisioningActions.finishRun({ kind: 'unknown' }, 1_700_000_060_000)

    const outcome = await connectRuntime(store, desktopPorts())

    expect(outcome).toBe('session-pending')
    expect(log.calls).toEqual(['runtime.getUsersInfo'])
  })
})
