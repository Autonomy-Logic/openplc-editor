import type { PluginCommandOutcome } from '../../../backend/shared/utils/vpp/screen-actions'
import type { OpenPLCStore } from '../../../frontend/store'
import { getErrorMessage } from '../../../frontend/utils/get-error-message'
import type {
  BootloaderCapabilitiesOptions,
  CompilationStatusResult,
  DiscoverDevicesOptions,
  DiscoverDevicesResult,
  DiscoveredRuntimeDevice,
  FetchedProject,
  ListUsersResult,
  LoginParams,
  LoginResult,
  PluginCommandArgs,
  RetrievableDevice,
  RuntimeCapabilitiesResult,
  RuntimeLogsResult,
  RuntimePort,
  RuntimeStatusResult,
  UpdateUserParams,
  UsersInfoResult,
  WhoAmIResult,
} from '../../shared/ports/runtime-port'
import type { SerialPort, Unsubscribe } from '../../shared/ports/types'

/** Ask the main process for the stored project on `ipAddress`, unpacked. An internal of `fetchRetrievableProject`. */
async function retrieveProjectFromDevice(ipAddress: string) {
  try {
    return await window.bridge.runtimeRetrieveProject(ipAddress)
  } catch (err) {
    return { success: false as const, error: getErrorMessage(err) }
  }
}

export function createEditorRuntimeAdapter(store: OpenPLCStore, getIpAddress: () => string): RuntimePort {
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

    bootloader: {
      async getCapabilities(options?: BootloaderCapabilitiesOptions) {
        try {
          return await window.bridge.bootloaderGetCapabilities(requireIp(), options)
        } catch (err) {
          return { success: false as const, error: getErrorMessage(err) }
        }
      },
      async login(username: string, password: string) {
        try {
          return await window.bridge.bootloaderLogin(requireIp(), username, password)
        } catch (err) {
          return { success: false as const, error: getErrorMessage(err) }
        }
      },
      async getStatus() {
        try {
          return await window.bridge.bootloaderGetStatus(requireIp())
        } catch (err) {
          return { success: false as const, error: getErrorMessage(err) }
        }
      },
      async getDeviceInfo() {
        try {
          return await window.bridge.bootloaderGetDeviceInfo(requireIp())
        } catch (err) {
          return { success: false as const, error: getErrorMessage(err) }
        }
      },
      async getRuntimeLogs(tail?: number) {
        try {
          return await window.bridge.bootloaderGetRuntimeLogs(requireIp(), tail)
        } catch (err) {
          return { success: false as const, error: getErrorMessage(err) }
        }
      },
      async startUpdate(version: string) {
        try {
          return await window.bridge.bootloaderStartUpdate(requireIp(), version)
        } catch (err) {
          return { success: false as const, error: getErrorMessage(err) }
        }
      },
      async getUpdateProgress() {
        try {
          return await window.bridge.bootloaderGetUpdateProgress(requireIp())
        } catch (err) {
          return { success: false as const, error: getErrorMessage(err) }
        }
      },
      async restartRuntime() {
        try {
          return await window.bridge.bootloaderRestartRuntime(requireIp())
        } catch (err) {
          return { success: false as const, error: getErrorMessage(err) }
        }
      },
      async clearSession() {
        try {
          await window.bridge.bootloaderClearSession(requireIp())
        } catch {
          // Best effort: a session the main process may already have dropped
          // is not worth surfacing to anybody.
        }
      },
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
        return await window.bridge.runtimeCreateUser(ip, params.username, params.password, params.role)
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

    async getRuntimeCapabilities(): Promise<RuntimeCapabilitiesResult> {
      try {
        const ip = requireIp()
        return await window.bridge.runtimeGetCapabilities(ip)
      } catch (err) {
        return { features: null, error: getErrorMessage(err) }
      }
    },

    async listUsers(): Promise<ListUsersResult> {
      try {
        const ip = requireIp()
        return await window.bridge.runtimeListUsers(ip)
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    async whoAmI(): Promise<WhoAmIResult> {
      try {
        const ip = requireIp()
        return await window.bridge.runtimeWhoAmI(ip)
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    async updateUser(userId: number, params: UpdateUserParams) {
      try {
        const ip = requireIp()
        return await window.bridge.runtimeUpdateUser(ip, userId, params)
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
      }
    },

    async deleteUser(userId: number) {
      try {
        const ip = requireIp()
        return await window.bridge.runtimeDeleteUser(ip, userId)
      } catch (err) {
        return { success: false, error: getErrorMessage(err) }
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

    async sendPluginCommand(args: PluginCommandArgs): Promise<PluginCommandOutcome> {
      try {
        const ip = requireIp()
        return await window.bridge.runtimeSendPluginCommand(ip, {
          plugin: args.plugin,
          command: args.command,
          params: args.params ?? {},
        })
      } catch (err) {
        return { ok: false, error: getErrorMessage(err) }
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

    async installRetrievedLibraries(project: FetchedProject, names: string[]) {
      try {
        return await window.bridge.runtimeInstallRetrievedLibraries(String(project.payload), names)
      } catch (err) {
        return { success: false, installed: [], failed: [{ name: '', error: getErrorMessage(err) }] }
      }
    },

    async listRetrievableDevices() {
      const result = await this.discoverDevices!({ durationMs: 3000 })
      if (!result.success) {
        return { success: false as const, error: result.error || 'Could not search the network.' }
      }
      return { success: true as const, devices: (result.devices ?? []).map(toRetrievableDevice) }
    },

    onRetrievableDeviceFound(callback: (device: RetrievableDevice) => void): Unsubscribe {
      return this.onDeviceDiscovered!((device) => callback(toRetrievableDevice(device)))
    },

    connectedRetrievableDeviceKey() {
      return loggedIn ? getIpAddress() : ''
    },

    selectRetrievableDevice(device: RetrievableDevice) {
      store.getState().deviceActions.setRuntimeIpAddress(device.key)
    },

    async fetchRetrievableProject(device: RetrievableDevice) {
      const retrieved = await retrieveProjectFromDevice(device.key)
      if (!retrieved.success || !retrieved.projectPath) {
        return { success: false as const, error: retrieved.error || 'The device did not return a project.' }
      }
      return {
        success: true as const,
        project: {
          projectName: retrieved.projectName ?? '',
          payload: retrieved.projectPath,
          libraries: retrieved.libraries,
        },
      }
    },
  }
}

/** One LAN reply, in the shape the shared picker reads, keyed by address. */
function toRetrievableDevice(device: DiscoveredRuntimeDevice): RetrievableDevice {
  return {
    key: device.ipAddress,
    name: device.ipAddress,
    location: device.hostname || undefined,
    answeredScan: true,
    projectName: device.projectName,
    projectTimestamp: device.projectTimestamp,
  }
}
