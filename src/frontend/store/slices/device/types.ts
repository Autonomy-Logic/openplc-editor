import type { DeviceLicenseReport } from '../../../../middleware/shared/ports/device-port'
import type { EtherCATRuntimeStatusResponse } from '../../../../middleware/shared/ports/ethercat-types'
import type {
  BoardInfo,
  CommunicationPort,
  DebugMedium,
  DeviceConfiguration,
  DeviceLinkTransport,
  DevicePin,
  PersistentStorageSettings,
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
   * Medium the DEBUG channel uses — the ONE fact the debug poller reads, for both
   * its batch size and its cadence (see `DEBUG_MEDIUM_PROFILE`). Published by the
   * connection manager, which is the only component that knows: the main process on
   * the editor, the WebRTC lifecycle manager in the browser.
   *
   * Can change mid-session on web, when a WebRTC data channel drops to the Edge
   * relay — the poller follows it, so this is read live rather than latched.
   */
  debugTransport: DebugMedium | null
}

// ---------------------------------------------------------------------------
// VPP licensing
// ---------------------------------------------------------------------------

/**
 * How long the purchase watch stays open after `buy()` opens the external
 * purchase page: 10 minutes, generous for a checkout without leaving a
 * forgotten watch polling a public rate-limited route forever. Stamped into
 * `DeviceLicenseInfo.awaitingPurchaseUntil` by `setAwaitingPurchase(true)`.
 */
export const PURCHASE_WATCH_WINDOW_MS = 10 * 60_000

/**
 * What the UI knows about the connected device's VPP license.
 *
 * Separate from `deviceConnection` on purpose: that is about whether the LINK is
 * up, this is about what the device is entitled to run. They change for unrelated
 * reasons — a link can drop and come back without the license changing, and a
 * license can be recovered without the link ever moving — and merging them made
 * every reader of one depend on the other.
 *
 * `report` is null until a licensing call has landed, which is also the state for
 * every non-licensable board: nothing runs, so nothing is known, and the UI shows
 * no licensing affordance at all.
 */
export type DeviceLicenseInfo = {
  /** In flight, so the UI can show progress and refuse to start a second one. */
  phase: 'idle' | 'checking' | 'done'
  /**
   * The last landed report from `readLicense` / `refreshLicense`. Carries the
   * outcome union and the derived `deviceId` (which the renderer cannot compute —
   * it needs `node:crypto` — and which feeds the copy button and the buy link).
   */
  report: DeviceLicenseReport | null
  /**
   * Wall-clock deadline (epoch ms) of the purchase watch, or null when no watch
   * is running. Non-null from `buy()` opening the purchase page until the poll
   * that watches for the completed purchase lands a licensed report, the
   * deadline passes, or the user cancels. Drives the "Waiting for purchase…"
   * affordance and the poll effect in `useDeviceLicense` — the purchase happens
   * in an external browser, so polling is the only feedback channel there is.
   *
   * An absolute deadline rather than a tick counter on purpose: the poll effect
   * can be torn down and remounted without renewing the window, a tick skipped
   * to avoid overlapping an in-flight call costs none of the budget, and the
   * state stays inspectable ("waiting until T", not an opaque count).
   */
  awaitingPurchaseUntil: number | null
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
  deviceConnection: DeviceConnection
  deviceLicense: DeviceLicenseInfo
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
  /** Set the persistent serial link state (optionally the port it's on). */
  setDeviceConnectionStatus: (
    status: DeviceConnectionStatus,
    port?: string | null,
    transport?: DeviceConnection['transport'],
    debugTransport?: DeviceConnection['debugTransport'],
  ) => void
  /** Reset the serial link to disconnected/null. */
  clearDeviceConnection: () => void
  /**
   * Mark a licensing call as in flight.
   *
   * Deliberately KEEPS the last report rather than clearing it. Blanking it would
   * make the badge flicker from "Licensed" to nothing and back on every refresh —
   * and worse, a refresh that fails would leave the UI with less information than
   * it had before asking. The `phase` is what says "asking"; the report stays as
   * the last thing actually known.
   */
  startDeviceLicenseCheck: () => void
  /** Land a finished licensing call: `phase='done'`, store the report. */
  setDeviceLicenseReport: (report: DeviceLicenseReport) => void
  /**
   * Open (true) or close (false) the purchase-watch window (see
   * `DeviceLicenseInfo.awaitingPurchaseUntil`). Opening stamps the absolute
   * deadline `now + PURCHASE_WATCH_WINDOW_MS`; closing nulls it. Otherwise
   * deliberately dumb: the poll effect in `useDeviceLicense` owns WHEN it ends
   * (licensed report, deadline, cancel) — the store only records the window.
   */
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
