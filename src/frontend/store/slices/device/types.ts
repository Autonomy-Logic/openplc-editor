import type { DeviceProbeResult } from '../../../../middleware/shared/ports/device-port'
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

/**
 * Pin mappings are scoped per target board: each board has its own
 * pinout (a Mega's pin 13 is not a thing on a MKR), so a flat array
 * shared across boards would either leak pins between targets or
 * lose work whenever the user switched. The dict is keyed by
 * `deviceConfiguration.deviceBoard`; the active board's array is
 * pulled out by `pinSelectors.usePins`, slice actions mutate the
 * active board's entry in place. Boards with no entry yet behave
 * like an empty array — actions create the entry on first write.
 *
 * Legacy projects saved with a flat `pins: DevicePin[]` get migrated
 * on load: the parser keys the legacy array under whatever board
 * `devices/configuration.json` names as the active one. See
 * `parse-project-files.ts` for the migration path.
 */
export type DevicePinMapping = {
  pinsByBoard: Record<string, DevicePin[]>
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
  /** Run/stop mode-switch position of the connected target, or null when
   *  unknown. Lives next to `plcStatus` so the Start/Stop button, its tooltip
   *  and the start pre-check all read one value, whatever the target type:
   *  Runtime v4 fills it from `/api/status`, baremetal from the device status
   *  poll. `'run'` on any device without a physical switch, so a null-safe
   *  caller treats absence as "no gating". */
  switchPosition: 'run' | 'stop' | null
  ipAddress: string | null
  /** Version string reported by the connected runtime (from
   *  get-users-info / the X-OpenPLC-Runtime-Version header), or null
   *  when unknown. Gates version-dependent UI like User Management. */
  runtimeVersion: string | null
  selectedDevice: SelectedDevice | null
  storedCredentials: StoredCredentials | null
  timingStats: TimingStats | null
  includeTimingStatsInPolling: boolean
  ethercatStatus: EtherCATRuntimeStatusResponse | null
  includeEthercatStatsInPolling: boolean
}

// ---------------------------------------------------------------------------
// Persistent serial connection (D72) — baremetal "stay connected"
// ---------------------------------------------------------------------------

export type DeviceConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

/**
 * Live state of the connection the main process holds to a baremetal target,
 * mirroring the connection manager — which remains the source of truth. Distinct
 * from `deviceProbeInfo` (the license classification): this is purely whether the
 * connection is up, and over what.
 */
export type DeviceConnection = {
  status: DeviceConnectionStatus
  /** Endpoint the connection is on (or was last attempted on): a serial path or an IP. */
  port: string | null
  /**
   * Medium the manager chose. Read-only mirror — nothing in the renderer picks a
   * transport; this exists because a few consumers must SIZE work to the medium
   * (the debug poll's frame budget differs between serial and TCP).
   */
  transport: 'rtu' | 'tcp' | 'simulator' | null
}

// ---------------------------------------------------------------------------
// Connect-time probe (D72)
// ---------------------------------------------------------------------------

/**
 * UI state for the CONNECT step (D72): "Connect" opens the device channel,
 * runs the Modbus/debug probe, and lands a classification the device screens
 * react to — a flash-firmware dialog on `no-firmware`, a buy/demo prompt from
 * `licenseStatus`, and a FULL/DEMO badge. The `result` is the last landed probe
 * (null before the first Connect); `phase` drives the button's spinner and
 * guards against overlapping probes.
 */
export type DeviceProbeInfo = {
  phase: 'idle' | 'probing' | 'done'
  result: DeviceProbeResult | null
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
  deviceProbeInfo: DeviceProbeInfo
  deviceConnection: DeviceConnection
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
    /** Pin mappings to seed the store with. Two shapes accepted:
     *  - `DevicePin[]`: legacy flat array. Keyed under whatever
     *    `configuration.deviceBoard` resolves to (or the store's
     *    current `deviceBoard` if the caller didn't pass config).
     *    The parser routes legacy projects through this branch on
     *    load so projects saved before per-board scoping continue
     *    to work without manual migration.
     *  - `Record<string, DevicePin[]>`: per-board dict, the
     *    canonical post-migration shape. */
    pinMapping?: DevicePin[] | Record<string, DevicePin[]>
  }) => void
  clearDeviceDefinitions: () => void
  resetDeviceUpdated: () => void
  selectPinTableRow: (row: number) => void
  createNewPin: () => void
  removePin: () => void
  updatePin: (updatedData: Partial<DevicePin>) => PinUpdateResponse
  setDeviceBoard: (board: string) => void
  /** Set a single platformOption key/value pair (e.g. cpu→atmega328old).
   *  Marks the device as updated to trigger config persistence. */
  setSelectedPlatformOption: (key: string, value: string) => void
  /** Wipe all platformOption selections. Called automatically on board
   *  change, can also be invoked by UI to reset to manifest defaults. */
  clearSelectedPlatformOptions: () => void
  setCommunicationPort: (port: string) => void
  setRuntimeIpAddress: (ipAddress: string) => void
  setRuntimeJwtToken: (token: string | null) => void
  setRuntimeConnectionStatus: (status: ConnectionStatus) => void
  setRuntimeVersion: (version: string | null) => void
  setPlcRuntimeStatus: (status: PlcStatus | null) => void
  /** Set the mode-switch position (null clears it, e.g. on disconnect). */
  setPlcSwitchPosition: (position: 'run' | 'stop' | null) => void
  setSelectedDevice: (device: SelectedDevice | null) => void
  setStoredCredentials: (credentials: StoredCredentials | null) => void
  setTimingStats: (stats: TimingStats | null) => void
  setIncludeTimingStatsInPolling: (include: boolean) => void
  setEthercatStatus: (status: EtherCATRuntimeStatusResponse | null) => void
  setIncludeEthercatStatsInPolling: (include: boolean) => void
  setTemporaryDhcpIp: (ipAddress?: string) => void
  clearRuntimeConnection: () => void
  /** Mark a connect probe as in flight — `phase='probing'`, clears the last
   *  result so the UI shows a spinner, not stale state, while it runs. */
  startDeviceProbe: () => void
  /** Land a finished connect probe — `phase='done'`, stores the classification. */
  setDeviceProbeResult: (result: DeviceProbeResult) => void
  /** Reset the probe to `idle`/null. Called on disconnect and project close. */
  clearDeviceProbe: () => void
  /** Set the persistent serial link state (optionally the port it's on). */
  setDeviceConnectionStatus: (
    status: DeviceConnectionStatus,
    port?: string | null,
    transport?: DeviceConnection['transport'],
  ) => void
  /** Reset the serial link to disconnected/null. */
  clearDeviceConnection: () => void
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

/**
 * Cross-slice root-state view the device slice needs at runtime —
 * `setAvailableOptions` triggers the alias sync once the workspace
 * screen finishes board discovery (capabilities depend on the active
 * board info), and the sync's summary log is routed through the
 * console slice. Same shape pattern as `ProjectSliceRoot`.
 */
import type { ConsoleSlice } from '../console'
import type { ProjectSlice } from '../project/types'

export type DeviceSliceRoot = DeviceSlice & ProjectSlice & ConsoleSlice
