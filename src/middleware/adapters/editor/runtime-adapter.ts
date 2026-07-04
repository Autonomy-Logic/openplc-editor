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
 *   - JWT token: owned entirely by the main process (the single token
 *     authority). The renderer no longer holds or passes the token — main
 *     injects it into every runtime call and refreshes it on expiry, then
 *     notifies the renderer via onTokenRefreshed. This adapter only tracks
 *     whether a session is active (for isReadyForDebug).
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
  // Whether a runtime session is active. The token itself lives in the main
  // process; this only gates isReadyForDebug.
  let loggedIn = false

  function requireIp(): string {
    const ip = getIpAddress()
    if (!ip) throw new Error('No runtime IP address configured')
    return ip
  }

  return {
    isReadyForDebug() {
      return getIpAddress() !== '' && loggedIn
    },

    async login(params: LoginParams): Promise<LoginResult> {
      try {
        const ip = requireIp()
        const result = await window.bridge.runtimeLogin(ip, params.username, params.password)
        if (result.success && result.accessToken) {
          loggedIn = true
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
        return await window.bridge.runtimeGetStatus(ip, includeStats)
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    async startPlc() {
      try {
        const ip = requireIp()
        return await window.bridge.runtimeStartPlc(ip)
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    async stopPlc() {
      try {
        const ip = requireIp()
        return await window.bridge.runtimeStopPlc(ip)
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    async getLogs(minId?: number): Promise<RuntimeLogsResult> {
      try {
        const ip = requireIp()
        return await window.bridge.runtimeGetLogs(ip, minId)
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    async getSerialPorts(): Promise<{ success: boolean; ports?: SerialPort[]; error?: string }> {
      try {
        const ip = requireIp()
        return await window.bridge.runtimeGetSerialPorts(ip)
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    async getCompilationStatus(): Promise<CompilationStatusResult> {
      try {
        const ip = requireIp()
        return await window.bridge.runtimeGetCompilationStatus(ip)
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    async clearCredentials() {
      loggedIn = false
      return window.bridge.runtimeClearCredentials()
    },

    onTokenRefreshed(callback: (newToken: string) => void): Unsubscribe {
      const handler = (_event: unknown, newToken: string) => callback(newToken)
      return window.bridge.onRuntimeTokenRefreshed(handler)
    },

    // --- EtherCAT Discovery ---

    async getNetworkInterfaces() {
      try {
        const ip = requireIp()
        return await window.bridge.etherCATGetInterfaces(ip)
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    async getEthercatServiceStatus() {
      try {
        const ip = requireIp()
        return await window.bridge.etherCATGetStatus(ip)
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    async scanEthercatDevices(request) {
      try {
        const ip = requireIp()
        return await window.bridge.etherCATScan(ip, request)
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    async testEthercatConnection(request) {
      try {
        const ip = requireIp()
        return await window.bridge.etherCATTest(ip, request)
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    async validateEthercatConfig(request) {
      try {
        const ip = requireIp()
        return await window.bridge.etherCATValidate(ip, request)
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    async getEthercatRuntimeStatus() {
      try {
        const ip = requireIp()
        return await window.bridge.etherCATGetRuntimeStatus(ip)
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
