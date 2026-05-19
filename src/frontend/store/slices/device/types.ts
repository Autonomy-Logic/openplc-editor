import type { EtherCATRuntimeStatusResponse } from '../../../../middleware/shared/ports/ethercat-types'
import type {
  BoardInfo,
  CommunicationPort,
  DeviceConfiguration,
  DevicePin,
  PlcStatus,
  TimingStats,
} from '../../../../middleware/shared/ports/types'

// ---------------------------------------------------------------------------
// Device available options
// ---------------------------------------------------------------------------

export type DeviceAvailableOptions = {
  availableBoards: Map<string, BoardInfo>
  availableCommunicationPorts: CommunicationPort[]
}

// ---------------------------------------------------------------------------
// Pin mapping
// ---------------------------------------------------------------------------

export type DevicePinMapping = {
  pins: DevicePin[]
  currentSelectedPinTableRow: number
}

// ---------------------------------------------------------------------------
// Runtime connection
// ---------------------------------------------------------------------------

export type SelectedDevice = {
  orchestratorId: string
  orchestratorAgentId: string
  deviceId: string
  deviceName: string
}

export type StoredCredentials = {
  username: string
  password: string
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export type RuntimeConnection = {
  jwtToken: string | null
  connectionStatus: ConnectionStatus
  plcStatus: PlcStatus | null
  ipAddress: string | null
  selectedDevice: SelectedDevice | null
  storedCredentials: StoredCredentials | null
  timingStats: TimingStats | null
  includeTimingStatsInPolling: boolean
  ethercatStatus: EtherCATRuntimeStatusResponse | null
  includeEthercatStatsInPolling: boolean
}

// ---------------------------------------------------------------------------
// Device state
// ---------------------------------------------------------------------------

export type DeviceState = {
  deviceAvailableOptions: DeviceAvailableOptions
  deviceDefinitions: {
    configuration: DeviceConfiguration
    pinMapping: DevicePinMapping
    temporaryDhcpIp?: string
  }
  deviceUpdated: {
    updated: boolean
  }
  runtimeConnection: RuntimeConnection
}

// ---------------------------------------------------------------------------
// Action parameter types
// ---------------------------------------------------------------------------

export type PinUpdateResponse = {
  ok: boolean
  title: string
  message: string
  data?: {
    pin: string
    pinType: string
    address: string
    alias: string
  }
}

// ---------------------------------------------------------------------------
// Device actions
// ---------------------------------------------------------------------------

export type DeviceActions = {
  setAvailableOptions: (options: {
    availableBoards?: Map<string, BoardInfo>
    availableCommunicationPorts?: CommunicationPort[]
  }) => void
  setDeviceDefinitions: (definitions: {
    configuration?: Partial<DeviceConfiguration>
    pinMapping?: DevicePin[]
  }) => void
  clearDeviceDefinitions: () => void
  resetDeviceUpdated: () => void
  selectPinTableRow: (row: number) => void
  createNewPin: () => void
  removePin: () => void
  updatePin: (updatedData: Partial<DevicePin>) => PinUpdateResponse
  setDeviceBoard: (board: string) => void
  setCommunicationPort: (port: string) => void
  setCompileOnly: (compileOnly: boolean) => void
  setRuntimeIpAddress: (ipAddress: string) => void
  setRuntimeJwtToken: (token: string | null) => void
  setRuntimeConnectionStatus: (status: ConnectionStatus) => void
  setPlcRuntimeStatus: (status: PlcStatus | null) => void
  setSelectedDevice: (device: SelectedDevice | null) => void
  setStoredCredentials: (credentials: StoredCredentials | null) => void
  setTimingStats: (stats: TimingStats | null) => void
  setIncludeTimingStatsInPolling: (include: boolean) => void
  setEthercatStatus: (status: EtherCATRuntimeStatusResponse | null) => void
  setIncludeEthercatStatsInPolling: (include: boolean) => void
  setTemporaryDhcpIp: (ipAddress?: string) => void
  clearRuntimeConnection: () => void
  setVendorScreenData: (persistenceKey: string, data: unknown) => void
  /** Restore `vendorScreenData[k]` for every k in `ownedKeys`: from
   *  `snapshot[k]` when present, else by deleting the key.  Used by
   *  the vendor-screen tab's "Don't save" revert. */
  restoreVendorScreenSlice: (ownedKeys: string[], snapshot: Record<string, unknown>) => void
}

// ---------------------------------------------------------------------------
// Device slice
// ---------------------------------------------------------------------------

export type DeviceSlice = DeviceState & {
  deviceActions: DeviceActions
}
