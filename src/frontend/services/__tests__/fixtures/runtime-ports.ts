import type { DevicePort } from '../../../../middleware/shared/ports/device-port'
import type {
  BootloaderApiResult,
  BootloaderCapabilities,
  BootloaderCapabilitiesOptions,
  BootloaderPort,
  RuntimePort,
  UsersInfoResult,
} from '../../../../middleware/shared/ports/runtime-port'
import type {
  RuntimeProvisioningEvent,
  RuntimeProvisioningOutcome,
  RuntimeProvisioningPort,
  RuntimeProvisioningRunRequest,
  SshProbeRequest,
  SshProbeResult,
} from '../../../../middleware/shared/ports/runtime-provisioning-port'
import type { BoardInfo } from '../../../../middleware/shared/ports/types'
import type { OpenPLCStore } from '../../../store'

export const DEVICE_IP = '192.168.1.50'
export const SSH_USERNAME = 'commissioner42'
export const SSH_PASSWORD = 'S3cr3t-Pi!'

export const RUNTIME_V4 = 'OpenPLC Runtime v4'

export const REFUSED: UsersInfoResult = {
  hasUsers: false,
  error: 'connect ECONNREFUSED 192.168.1.50:8443',
  failure: 'refused',
}

export const BOOTLOADER_SILENT: BootloaderApiResult<BootloaderCapabilities> = {
  success: false,
  error: 'connect ECONNREFUSED 192.168.1.50:8445',
}

export function bootloaderReports(state: string, recovery: boolean): BootloaderApiResult<BootloaderCapabilities> {
  return { success: true, data: { service: 'openplc-bootloader', bootloaderVersion: '1.0.0', state, recovery } }
}

export function boardInfo(transport: 'websocket' | 'modbus-tcp', uploadMethod?: 'ethernet'): BoardInfo {
  return {
    compiler: 'openplc-compiler',
    core: '',
    preview: '',
    specs: {},
    uploadMethod,
    capabilities: { debuggerTransports: [transport] },
  }
}

export interface PortCallLog {
  calls: string[]
  onCall: ((member: string) => void) | null
}

export function createCallLog(): PortCallLog {
  return { calls: [], onCall: null }
}

function record(log: PortCallLog, member: string): void {
  log.calls.push(member)
  log.onCall?.(member)
}

function unexpected(log: PortCallLog, member: string): Promise<never> {
  record(log, `unexpected ${member}`)
  return Promise.reject(new Error(`unexpected call to ${member}`))
}

export function unexpectedCalls(log: PortCallLog): string[] {
  return log.calls.filter((call) => call.startsWith('unexpected '))
}

export class FakeRuntime {
  usersInfoAnswers: (UsersInfoResult | Error)[] = [{ hasUsers: true, runtimeVersion: '4.2.0' }]
  bootloaderAnswer: BootloaderApiResult<BootloaderCapabilities> = BOOTLOADER_SILENT
  readonly capabilitiesOptions: (BootloaderCapabilitiesOptions | undefined)[] = []
  readonly deviceContexts: ({ agentId: string; deviceId: string } | null)[] = []
  readonly port: RuntimePort

  constructor(log: PortCallLog) {
    const bootloader: BootloaderPort = {
      getCapabilities: (options) => {
        this.capabilitiesOptions.push(options)
        record(log, 'bootloader.getCapabilities')
        return Promise.resolve(this.bootloaderAnswer)
      },
      login: () => unexpected(log, 'bootloader.login'),
      getStatus: () => unexpected(log, 'bootloader.getStatus'),
      getDeviceInfo: () => unexpected(log, 'bootloader.getDeviceInfo'),
      getRuntimeLogs: () => unexpected(log, 'bootloader.getRuntimeLogs'),
      startUpdate: () => unexpected(log, 'bootloader.startUpdate'),
      getUpdateProgress: () => unexpected(log, 'bootloader.getUpdateProgress'),
      restartRuntime: () => unexpected(log, 'bootloader.restartRuntime'),
      clearSession: () => unexpected(log, 'bootloader.clearSession'),
    }
    this.port = {
      bootloader,
      setDeviceContext: (context) => {
        this.deviceContexts.push(context)
        record(log, 'runtime.setDeviceContext')
      },
      getUsersInfo: () => {
        record(log, 'runtime.getUsersInfo')
        const answer = this.usersInfoAnswers.length > 1 ? this.usersInfoAnswers.shift() : this.usersInfoAnswers[0]
        if (answer === undefined) return Promise.reject(new Error('no users-info answer was set'))
        if (answer instanceof Error) return Promise.reject(answer)
        return Promise.resolve(answer)
      },
      login: () => unexpected(log, 'runtime.login'),
      createUser: () => unexpected(log, 'runtime.createUser'),
      getRuntimeCapabilities: () => unexpected(log, 'runtime.getRuntimeCapabilities'),
      listUsers: () => unexpected(log, 'runtime.listUsers'),
      whoAmI: () => unexpected(log, 'runtime.whoAmI'),
      updateUser: () => unexpected(log, 'runtime.updateUser'),
      deleteUser: () => unexpected(log, 'runtime.deleteUser'),
      getStatus: () => unexpected(log, 'runtime.getStatus'),
      startPlc: () => unexpected(log, 'runtime.startPlc'),
      stopPlc: () => unexpected(log, 'runtime.stopPlc'),
      getLogs: () => unexpected(log, 'runtime.getLogs'),
      getSerialPorts: () => unexpected(log, 'runtime.getSerialPorts'),
      getCompilationStatus: () => unexpected(log, 'runtime.getCompilationStatus'),
      clearCredentials: () => unexpected(log, 'runtime.clearCredentials'),
    }
  }
}

export function createFakeDevice(log: PortCallLog): DevicePort {
  return {
    getAvailableBoards: () => unexpected(log, 'device.getAvailableBoards'),
    getCommunicationPorts: () => unexpected(log, 'device.getCommunicationPorts'),
    refreshBoards: () => unexpected(log, 'device.refreshBoards'),
    refreshCommunicationPorts: () => unexpected(log, 'device.refreshCommunicationPorts'),
    getPreviewImage: () => unexpected(log, 'device.getPreviewImage'),
    getVendorDocumentUrl: () => {
      record(log, 'unexpected device.getVendorDocumentUrl')
      return null
    },
    connect: () => unexpected(log, 'device.connect'),
    releaseSerialPort: () => unexpected(log, 'device.releaseSerialPort'),
    disconnect: () => unexpected(log, 'device.disconnect'),
    onConnectionStatus: () => {
      record(log, 'unexpected device.onConnectionStatus')
      return () => undefined
    },
  }
}

const SSH_SILENT: SshProbeResult = { answered: false, reason: 'timeout' }

export class FakeProvisioning {
  readonly sshAnswers = new Map<number, SshProbeResult>()
  readonly probeRequests: SshProbeRequest[] = []
  readonly runRequests: RuntimeProvisioningRunRequest[] = []
  cancelCalls = 0
  readonly port: RuntimeProvisioningPort
  private readonly listeners = new Set<(event: RuntimeProvisioningEvent) => void>()
  private readonly pendingRuns: ((outcome: RuntimeProvisioningOutcome) => void)[] = []

  constructor(log: PortCallLog) {
    this.port = {
      probeSsh: (request) => {
        this.probeRequests.push({ ...request })
        record(log, `provisioning.probeSsh ${request.host}:${request.port}`)
        return Promise.resolve(this.sshAnswers.get(request.port) ?? SSH_SILENT)
      },
      run: (request) => {
        this.runRequests.push({ ...request })
        record(log, 'provisioning.run')
        return new Promise<RuntimeProvisioningOutcome>((resolve) => {
          this.pendingRuns.push(resolve)
        })
      },
      cancel: () => {
        this.cancelCalls += 1
        record(log, 'provisioning.cancel')
        return Promise.resolve()
      },
      onEvent: (callback) => {
        const listener = (event: RuntimeProvisioningEvent): void => callback(event)
        this.listeners.add(listener)
        return () => {
          this.listeners.delete(listener)
        }
      },
    }
  }

  answerSshOn(port: number): void {
    this.sshAnswers.set(port, { answered: true })
  }

  get subscriberCount(): number {
    return this.listeners.size
  }

  get pendingRunCount(): number {
    return this.pendingRuns.length
  }

  emit(event: RuntimeProvisioningEvent): void {
    for (const listener of [...this.listeners]) listener(event)
  }

  endRun(outcome: RuntimeProvisioningOutcome): void {
    const resolve = this.pendingRuns.shift()
    if (resolve === undefined) throw new Error('no provisioning run is pending')
    resolve(outcome)
  }
}

export function settle(condition: () => boolean, turnsLeft = 200): Promise<void> {
  if (condition()) return Promise.resolve()
  if (turnsLeft === 0) return Promise.reject(new Error('the awaited condition never held'))
  return Promise.resolve().then(() => settle(condition, turnsLeft - 1))
}

export function connectionStatus(store: OpenPLCStore): string {
  return store.getState().runtimeConnection.connectionStatus
}

export function selectRuntimeTarget(store: OpenPLCStore, board: string, address: string, info?: BoardInfo): void {
  if (info) store.getState().deviceActions.setAvailableOptions({ availableBoards: new Map([[board, info]]) })
  store.getState().deviceActions.setDeviceBoard(board)
  store.getState().deviceActions.setRuntimeIpAddress(address)
}

export function modalText(data: unknown): string {
  if (typeof data !== 'object' || data === null) return ''
  const title = 'title' in data && typeof data.title === 'string' ? data.title : ''
  const message = 'message' in data && typeof data.message === 'string' ? data.message : ''
  return `${title}\n${message}`
}

export function serializedState(store: OpenPLCStore): string {
  const seen = new WeakSet<object>()
  return JSON.stringify(store.getState(), (_key: string, value: unknown) => {
    if (value instanceof Map) return Array.from(value.entries())
    if (value instanceof Set) return Array.from(value.values())
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[seen]'
      seen.add(value)
    }
    return value
  })
}
