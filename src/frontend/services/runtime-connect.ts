import type { DevicePort } from '@root/middleware/shared/ports/device-port'
import type { RuntimePort, UsersInfoResult } from '@root/middleware/shared/ports/runtime-port'
import type { RuntimeProvisioningPort } from '@root/middleware/shared/ports/runtime-provisioning-port'
import {
  decideAfterBootloader,
  DEFAULT_SSH_PORT,
  PROVISIONING_BOOTLOADER_TIMEOUT_MS,
  startsProvisioningChecks,
} from '@root/middleware/shared/utils/runtime-provisioning'
import type { BoardInfoLike } from '@root/middleware/shared/utils/target-capabilities'

import type { OpenPLCStore } from '../store'
import { isEthernetUploadTarget, isOpenPLCRuntimeV4Target, validateRuntimeVersion } from '../utils/device'
import { getErrorMessage } from '../utils/get-error-message'
import { provisioningMessage } from '../utils/runtime-provisioning-messages'
import { describeRuntimeTarget } from './device-link-resolution'

export type RuntimeConnectOutcome = 'noop' | 'session-pending' | 'provisioning-flow' | 'failed'

export interface RuntimeConnectPorts {
  runtime: RuntimePort
  device: DevicePort
  runtimeProvisioning?: RuntimeProvisioningPort
}

export interface RuntimeConnectOptions {
  allowProvisioningFlow?: boolean
}

interface ConnectTarget {
  deviceBoard: string
  runtimeIpAddress: string
}

export function isProvisioningTarget(boardTarget: string, boardInfo: BoardInfoLike | undefined): boolean {
  return isOpenPLCRuntimeV4Target(boardTarget, boardInfo) && !isEthernetUploadTarget(boardInfo)
}

function reportUnreachable(store: OpenPLCStore, target: ConnectTarget, reason: string): void {
  const state = store.getState()
  const deviceName = state.runtimeConnection.selectedDevice?.deviceName
  const name = target.runtimeIpAddress
    ? describeRuntimeTarget(target.deviceBoard, target.runtimeIpAddress)
    : deviceName
      ? `"${deviceName}"`
      : 'the runtime'
  state.modalActions.openModal('debugger-message', {
    type: 'error',
    title: 'No Response',
    message: `Could not reach ${name}: ${reason}. Check that it is powered and on the network, and that the IP address is correct.`,
    buttons: ['OK'],
    onResponse: () => undefined,
  })
}

function failConnect(store: OpenPLCStore, target: ConnectTarget, reason: string): RuntimeConnectOutcome {
  store.getState().deviceActions.setRuntimeConnectionStatus('error')
  reportUnreachable(store, target, reason)
  return 'failed'
}

function provisioningPortFor(
  store: OpenPLCStore,
  ports: RuntimeConnectPorts,
  options: RuntimeConnectOptions,
  target: ConnectTarget,
  result: UsersInfoResult,
): RuntimeProvisioningPort | null {
  if (options.allowProvisioningFlow === false) return null
  if (!startsProvisioningChecks(result.failure)) return null
  const port = ports.runtimeProvisioning
  if (port === undefined || !target.runtimeIpAddress) return null
  const state = store.getState()
  if (state.runtimeConnection.selectedDevice) return null
  const boardInfo = state.deviceAvailableOptions.availableBoards.get(target.deviceBoard)
  return isProvisioningTarget(target.deviceBoard, boardInfo) ? port : null
}

function openBootloaderMessage(store: OpenPLCStore, host: string, kind: 'recovery' | 'bootloader-busy', state: string) {
  const { title, body } = provisioningMessage(kind, { host, state })
  store.getState().modalActions.openModal('debugger-message', {
    type: kind === 'recovery' ? 'error' : 'warning',
    title,
    message: body,
    buttons: ['OK'],
    onResponse: () => undefined,
  })
}

async function runProvisioningChecks(
  store: OpenPLCStore,
  runtime: RuntimePort,
  provisioning: RuntimeProvisioningPort,
  host: string,
): Promise<RuntimeConnectOutcome> {
  const capabilities = await runtime.bootloader.getCapabilities({ timeoutMs: PROVISIONING_BOOTLOADER_TIMEOUT_MS })
  const decision = decideAfterBootloader(capabilities)
  if (decision.kind === 'recovery') {
    openBootloaderMessage(store, host, 'recovery', decision.state)
  } else if (decision.kind === 'busy') {
    openBootloaderMessage(store, host, 'bootloader-busy', decision.state)
  } else {
    const sshPort = store.getState().runtimeProvisioning.sessionSshPorts[host] ?? DEFAULT_SSH_PORT
    const probe = await provisioning.probeSsh({ host, port: sshPort })
    if (probe.answered) {
      store.getState().runtimeProvisioningActions.showOffer(host, sshPort)
    } else {
      store.getState().modalActions.openModal('runtime-no-device', { host, sshPort })
    }
  }
  store.getState().deviceActions.setRuntimeConnectionStatus('disconnected')
  return 'provisioning-flow'
}

function continueWithSession(store: OpenPLCStore, deviceBoard: string, result: UsersInfoResult): RuntimeConnectOutcome {
  const { deviceActions, modalActions } = store.getState()
  deviceActions.setRuntimeVersion(result.runtimeVersion ?? null)
  const versionValidation = validateRuntimeVersion(deviceBoard, result.runtimeVersion)
  const proceedWithConnection = (): void => {
    store.getState().modalActions.openModal(result.hasUsers ? 'runtime-login' : 'runtime-create-user', null)
  }

  if (versionValidation.status === 'mismatch') {
    deviceActions.setRuntimeConnectionStatus('error')
    modalActions.openModal('debugger-message', {
      type: 'error',
      title: 'Runtime Version Mismatch',
      message: versionValidation.message || 'Unknown version mismatch error',
      buttons: ['OK'],
      onResponse: () => undefined,
    })
    return 'failed'
  }

  if (versionValidation.status === 'missing') {
    modalActions.openModal('debugger-message', {
      type: 'warning',
      title: 'Older Runtime Detected',
      message: versionValidation.message || 'Could not detect runtime version.',
      buttons: ['Continue Anyway', 'Cancel'],
      onResponse: (buttonIndex: number) => {
        if (buttonIndex === 0) {
          proceedWithConnection()
        } else {
          store.getState().deviceActions.setRuntimeConnectionStatus('disconnected')
        }
      },
    })
    return 'session-pending'
  }

  proceedWithConnection()
  return 'session-pending'
}

export async function connectRuntime(
  store: OpenPLCStore,
  ports: RuntimeConnectPorts,
  options: RuntimeConnectOptions = {},
): Promise<RuntimeConnectOutcome> {
  const initial = store.getState()
  const { stage } = initial.runtimeProvisioning.view
  if (stage === 'running' || stage === 'offer') {
    initial.runtimeProvisioningActions.setDialogVisible(true)
    return 'provisioning-flow'
  }
  const { connectionStatus, selectedDevice } = initial.runtimeConnection
  if (connectionStatus === 'connected' || connectionStatus === 'connecting') return 'noop'

  const { deviceBoard, runtimeIpAddress } = initial.deviceDefinitions.configuration
  const target: ConnectTarget = { deviceBoard, runtimeIpAddress: runtimeIpAddress || '' }
  if (!target.runtimeIpAddress && !selectedDevice) return 'failed'

  initial.deviceActions.setRuntimeConnectionStatus('connecting')
  try {
    if (selectedDevice) {
      ports.runtime.setDeviceContext?.({
        agentId: selectedDevice.orchestratorAgentId,
        deviceId: selectedDevice.deviceId,
      })
    }
    const result = await ports.runtime.getUsersInfo()
    if (result.error) {
      const provisioning = provisioningPortFor(store, ports, options, target, result)
      if (provisioning === null) return failConnect(store, target, result.error)
      return await runProvisioningChecks(store, ports.runtime, provisioning, target.runtimeIpAddress)
    }
    return continueWithSession(store, deviceBoard, result)
  } catch (error) {
    return failConnect(store, target, getErrorMessage(error))
  }
}
