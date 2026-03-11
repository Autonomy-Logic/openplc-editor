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

import type {
  CompilationStatusResult,
  LoginParams,
  LoginResult,
  RuntimeLogsResult,
  RuntimePort,
  RuntimeStatusResult,
  UsersInfoResult,
} from '../../frontend/providers/platform/ports/runtime-port'
import type { SerialPort, Unsubscribe } from '../../frontend/providers/platform/ports/types'

export function createEditorRuntimeAdapter(getIpAddress: () => string): RuntimePort {
  let jwtToken = ''

  function requireIp(): string {
    const ip = getIpAddress()
    if (!ip) throw new Error('No runtime IP address configured')
    return ip
  }

  return {
    async login(params: LoginParams): Promise<LoginResult> {
      try {
        const ip = requireIp()
        const result = await window.bridge.runtimeLogin(ip, params.username, params.password)
        if (result.success && result.accessToken) {
          jwtToken = result.accessToken
        }
        return result
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },

    async createUser(params) {
      try {
        const ip = requireIp()
        return await window.bridge.runtimeCreateUser(ip, params.username, params.password)
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },

    async getUsersInfo(): Promise<UsersInfoResult> {
      try {
        const ip = requireIp()
        return await window.bridge.runtimeGetUsersInfo(ip)
      } catch (err) {
        return { hasUsers: false, error: err instanceof Error ? err.message : String(err) }
      }
    },

    async getStatus(includeStats?: boolean): Promise<RuntimeStatusResult> {
      try {
        const ip = requireIp()
        return await window.bridge.runtimeGetStatus(ip, jwtToken, includeStats)
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },

    async startPlc() {
      try {
        const ip = requireIp()
        return await window.bridge.runtimeStartPlc(ip, jwtToken)
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },

    async stopPlc() {
      try {
        const ip = requireIp()
        return await window.bridge.runtimeStopPlc(ip, jwtToken)
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },

    async getLogs(minId?: number): Promise<RuntimeLogsResult> {
      try {
        const ip = requireIp()
        return await window.bridge.runtimeGetLogs(ip, jwtToken, minId)
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },

    async getSerialPorts(): Promise<{ success: boolean; ports?: SerialPort[]; error?: string }> {
      try {
        const ip = requireIp()
        return await window.bridge.runtimeGetSerialPorts(ip, jwtToken)
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },

    async getCompilationStatus(): Promise<CompilationStatusResult> {
      try {
        const ip = requireIp()
        return await window.bridge.runtimeGetCompilationStatus(ip, jwtToken)
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
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
  }
}
