import type { VppPackagePin } from '../../../../backend/shared/types/PLC/devices/configuration'
import type { DeviceLicenseReport } from '../../../../middleware/shared/ports/device-port'
import type { EtherCATRuntimeStatusResponse } from '../../../../middleware/shared/ports/ethercat-types'
import type {
  BoardInfo,
  CommunicationPort,
  DebugMedium,
  DeviceConfiguration,
  DeviceLinkTransport,
  DevicePin,
  IoMappingEntry,
  PersistentStorageSettings,
  PlcStatus,
  ProjectTargetDevice,
  TimingStats,
} from '../../../../middleware/shared/ports/types'
import type { DeviceVpp } from '../../../../middleware/shared/ports/vpp-types'
import type { DeviceSetupRecord } from '../../../utils/vpp/device-setup'

export type DeviceAvailableOptions = {
  availableBoards: Map<string, BoardInfo>
  availableCommunicationPorts: CommunicationPort[]
}

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

export type SelectedDevice = {
  orchestratorId: string
  orchestratorAgentId: string
  deviceId: string
  deviceName: string
  /** Whether this vPLC holds the Device's backplane I/O. Absent means the host did not say, not `false`. */
  backplaneAccess?: boolean
  /**
   * The vendor package this vPLC runs. `null` means it was created without
   * one; absent means the host predates the field and said nothing, which
   * gates nothing. Selecting a device with a package is what makes the IDE
   * fetch its archive and offer its boards.
   */
  vpp?: DeviceVpp | null
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
  /**
   * Features the connected runtime advertises in its hello
   * response, e.g. `["ethercat.dynamic_alloc"]`. `null` when
   * the runtime did not advertise a `features` array (an older EtherDOG). The pre-build
   * capability gate reads this to decide whether the project can be built
   * against the connected runtime.
   */
  runtimeFeatures: readonly string[] | null
  selectedDevice: SelectedDevice | null
  storedCredentials: StoredCredentials | null
  timingStats: TimingStats | null
  includeTimingStatsInPolling: boolean
  ethercatStatus: EtherCATRuntimeStatusResponse | null
  includeEthercatStatsInPolling: boolean
  /** A runtime version change is in flight on the device. */
  runtimeUpdateInProgress: boolean
}

export type DeviceConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

/**
 * Live state of the connection the main process holds to a baremetal target,
 * mirroring the connection manager — which remains the source of truth. Purely
 * whether the connection is up, and over what.
 */
export type DeviceConnection = {
  status: DeviceConnectionStatus
  /** Endpoint the connection is on (or was last attempted on): a serial path or an IP. */
  port: string | null
  /**
   * Medium the CONTROL channel uses. Read-only mirror — nothing in the renderer
   * picks a transport. Null for a REST-controlled runtime session, which holds no
   * connection.
   */
  transport: DeviceLinkTransport | null
  /**
   * Medium the DEBUG channel uses — the ONE fact the debug poller reads, for both its batch size and its cadence
   * (see `DEBUG_MEDIUM_PROFILE`).
   */
  debugTransport: DebugMedium | null
}

/**
 * How long the purchase watch stays open after `buy()` opens the external
 * purchase page: 10 minutes, generous for a checkout without leaving a
 * forgotten watch polling a public rate-limited route forever. Stamped into
 * `DeviceLicenseInfo.awaitingPurchaseUntil` by `setAwaitingPurchase(true)`.
 */
export const PURCHASE_WATCH_WINDOW_MS = 10 * 60_000

/** What the UI knows about the connected device's VPP license. */
export type DeviceLicenseInfo = {
  /** In flight, so the UI can show progress and refuse to start a second one. */
  phase: 'idle' | 'checking' | 'done'
  /**
   * The last landed report from `readLicense` / `refreshLicense`. Carries the
   * outcome union and the derived `deviceId` (which the renderer cannot compute —
   * it needs `node:crypto` — and which feeds the copy button and the buy link).
   */
  report: DeviceLicenseReport | null
  /** Wall-clock deadline (epoch ms) of the purchase watch, or null when no watch is running. */
  awaitingPurchaseUntil: number | null
}

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
  deviceConnection: DeviceConnection
  deviceLicense: DeviceLicenseInfo
}

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

/** What an embedded configurator persists: its archive is opaque and kept byte-for-byte. */
export type ConfiguratorRecord = {
  archive: string
  controller: string
  bundleVersion: string
}

export type ConfiguratorSnapshotRecord = {
  configurator: ConfiguratorRecord
  deviceSetup: DeviceSetupRecord
  /** Manifest module id per slot; `null` where the configurator's type id is not in the manifest. */
  moduleConfiguration: { slots: Array<string | null> }
  ioMapping: { entries: IoMappingEntry[] }
}

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
  /** Drops the last license check when the address changes, unless `sameDevice` says the device only moved. */
  setRuntimeIpAddress: (ipAddress: string, options?: { sameDevice?: boolean }) => void
  setRuntimeJwtToken: (token: string | null) => void
  setRuntimeConnectionStatus: (status: ConnectionStatus) => void
  setRuntimeVersion: (version: string | null) => void
  /** Record the EtherDOG features the runtime advertises.
   *  Pass `null` to clear (e.g. on disconnect), `[]` when the runtime
   *  does not publish a `features` array. */
  setRuntimeFeatures: (features: readonly string[] | null) => void
  setPlcRuntimeStatus: (status: PlcStatus | null) => void
  /** Set the mode-switch position (null clears it, e.g. on disconnect). */
  setPlcSwitchPosition: (position: 'run' | 'stop' | null) => void
  setSelectedDevice: (device: SelectedDevice | null) => void
  /**
   * Record the vPLC this project targets (null clears it). A project property:
   * a change marks the device configuration for saving; an unchanged value is a no-op.
   */
  setTargetDevice: (target: ProjectTargetDevice | null) => void
  setStoredCredentials: (credentials: StoredCredentials | null) => void
  setTimingStats: (stats: TimingStats | null) => void
  setIncludeTimingStatsInPolling: (include: boolean) => void
  /** Suspend "connection lost" detection while the runtime is being replaced. */
  setRuntimeUpdateInProgress: (inProgress: boolean) => void
  setEthercatStatus: (status: EtherCATRuntimeStatusResponse | null) => void
  setIncludeEthercatStatsInPolling: (include: boolean) => void
  setTemporaryDhcpIp: (ipAddress?: string) => void
  clearRuntimeConnection: () => void
  /** Set the persistent serial link state (optionally the port it's on). */
  setDeviceConnectionStatus: (
    status: DeviceConnectionStatus,
    port?: string | null,
    transport?: DeviceConnection['transport'],
    debugTransport?: DeviceConnection['debugTransport'],
  ) => void
  /** Reset the serial link to disconnected/null. */
  clearDeviceConnection: () => void
  /** Mark a licensing call as in flight. */
  startDeviceLicenseCheck: () => void
  /** Land a finished licensing call: `phase='done'`, store the report. */
  setDeviceLicenseReport: (report: DeviceLicenseReport) => void
  /** Open (true) or close (false) the purchase-watch window (see `DeviceLicenseInfo.awaitingPurchaseUntil`). */
  setAwaitingPurchase: (awaiting: boolean) => void
  /** Reset licensing to `idle`/null — on disconnect, board change, project close. */
  clearDeviceLicense: () => void
  /**
   * Update the project's persistent-storage (RETAIN) settings.
   *
   * A project property: the values travel with the project, are editable with
   * no device attached, and reach the runtime as `retain.conf` in the upload.
   * Partial by design so the screen can change one field at a time without
   * re-sending the other two.
   */
  setPersistentStorage: (patch: Partial<PersistentStorageSettings>) => void
  /** Record (or clear, with `null`) the VPP package a board was authored against. */
  setVppPackagePin: (board: string, pin: VppPackagePin | null) => void
  /** Write one screen section's state. A `serial` state carrying `rs485_en_pins` is stored without the legacy RS-485 pin pair. */
  setVendorScreenData: (persistenceKey: string, data: unknown) => void
  /** Write an embedded configurator's archive, device setup and derived I/O mapping as one store update. */
  setConfiguratorSnapshot: (configuratorKey: string, snapshot: ConfiguratorSnapshotRecord) => void
  /** Restore `vendorScreenData[k]` for every k in `ownedKeys`: from
   *  `snapshot[k]` when present, else by deleting the key.  Used by
   *  the vendor-screen tab's "Don't save" revert. */
  restoreVendorScreenSlice: (ownedKeys: string[], snapshot: Record<string, unknown>) => void
}

export type DeviceSlice = DeviceState & {
  deviceActions: DeviceActions
}

import type { ConsoleSlice } from '../console'
import type { ProjectSlice } from '../project/types'

export type DeviceSliceRoot = DeviceSlice & ProjectSlice & ConsoleSlice
