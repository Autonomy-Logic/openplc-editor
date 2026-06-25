/**
 * Editor RuntimePort adapter — delegates to Electron IPC bridge.
 *
 * Communicates with the main process RuntimeModule via window.bridge.runtime*
 * methods. The main process handles HTTPS calls to the OpenPLC runtime device,
 * including self-signed certificate support and automatic JWT token refresh.
 *
 * Connection context:
 *   - IP address: provided via getIpAddress() callback injected at creation.
 *     Set by the store/UI when the user configures the device.
 *   - JWT token: managed internally. Stored after successful login(),
 *     updated on token-refresh events, cleared on clearCredentials().
 */

import { getErrorMessage } from '../../../frontend/utils/get-error-message'
import type {
  CompilationStatusResult,
  DiscoverDevicesOptions,
  DiscoverDevicesResult,
  DiscoveredRuntimeDevice,
  LoginParams,
  LoginResult,
  RuntimeLogsResult,
  RuntimePort,
  RuntimeStatusResult,
  UsersInfoResult,
} from '../../shared/ports/runtime-port'
import type { SerialPort, Unsubscribe } from '../../shared/ports/types'

export function createEditorRuntimeAdapter(getIpAddress: () => string): RuntimePort {
  let jwtToken = ''

  function requireIp(): string {
    const ip = getIpAddress()
    if (!ip) throw new Error('No runtime IP address configured')
    return ip
  }

  return {
    isReadyForDebug() {
      return getIpAddress() !== '' && jwtToken !== ''
    },

    async login(params: LoginParams): Promise<LoginResult> {
      try {
        const ip = requireIp()
        const result = await window.bridge.runtimeLogin(ip, params.username, params.password)
        if (result.success && result.accessToken) {
          jwtToken = result.accessToken
        }
        return result
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    async createUser(params) {
      try {
        const ip = requireIp()
        return await window.bridge.runtimeCreateUser(ip, params.username, params.password)
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    async getUsersInfo(): Promise<UsersInfoResult> {
      try {
        const ip = requireIp()
        return await window.bridge.runtimeGetUsersInfo(ip)
      } catch (err) {
        return { hasUsers: false, error: getErrorMessage(err) }
      }
    },

    async getStatus(includeStats?: boolean): Promise<RuntimeStatusResult> {
      try {
        const ip = requireIp()
        return await window.bridge.runtimeGetStatus(ip, jwtToken, includeStats)
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    async startPlc() {
      try {
        const ip = requireIp()
        return await window.bridge.runtimeStartPlc(ip, jwtToken)
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    async stopPlc() {
      try {
        const ip = requireIp()
        return await window.bridge.runtimeStopPlc(ip, jwtToken)
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    async getLogs(minId?: number): Promise<RuntimeLogsResult> {
      try {
        const ip = requireIp()
        return await window.bridge.runtimeGetLogs(ip, jwtToken, minId)
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    async getSerialPorts(): Promise<{ success: boolean; ports?: SerialPort[]; error?: string }> {
      try {
        const ip = requireIp()
        return await window.bridge.runtimeGetSerialPorts(ip, jwtToken)
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    async getCompilationStatus(): Promise<CompilationStatusResult> {
      try {
        const ip = requireIp()
        return await window.bridge.runtimeGetCompilationStatus(ip, jwtToken)
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    async clearCredentials() {
      jwtToken = ''
      return window.bridge.runtimeClearCredentials()
    },

    onTokenRefreshed(callback: (newToken: string) => void): Unsubscribe {
      const handler = (_event: unknown, newToken: string) => {
        jwtToken = newToken
        callback(newToken)
      }
      return window.bridge.onRuntimeTokenRefreshed(handler)
    },

    // --- EtherCAT Discovery ---

    async getNetworkInterfaces() {
      try {
        const ip = requireIp()
        return await window.bridge.etherCATGetInterfaces(ip, jwtToken)
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    async getEthercatServiceStatus() {
      try {
        const ip = requireIp()
        return await window.bridge.etherCATGetStatus(ip, jwtToken)
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    async scanEthercatDevices(request) {
      try {
        const ip = requireIp()
        return await window.bridge.etherCATScan(ip, jwtToken, request)
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    async testEthercatConnection(request) {
      try {
        const ip = requireIp()
        return await window.bridge.etherCATTest(ip, jwtToken, request)
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    async validateEthercatConfig(request) {
      try {
        const ip = requireIp()
        return await window.bridge.etherCATValidate(ip, jwtToken, request)
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    async getEthercatRuntimeStatus() {
      try {
        const ip = requireIp()
        return await window.bridge.etherCATGetRuntimeStatus(ip, jwtToken)
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    // --- LAN discovery ---

    async discoverDevices(opts?: DiscoverDevicesOptions): Promise<DiscoverDevicesResult> {
      try {
        return await window.bridge.runtimeDiscoverDevices(opts)
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    onDeviceDiscovered(callback: (device: DiscoveredRuntimeDevice) => void): Unsubscribe {
      const handler = (_event: unknown, device: DiscoveredRuntimeDevice) => callback(device)
      return window.bridge.onRuntimeDeviceDiscovered(handler)
    },
  }
}
