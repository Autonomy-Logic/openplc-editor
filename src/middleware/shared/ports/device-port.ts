/**
 * DevicePort — Abstracts hardware/board discovery and configuration.
 *
 * Editor adapter: Delegates to main process which reads HAL JSON files from
 *                 resources/bin/ and queries arduino-cli for installed cores.
 *                 Board preview images loaded from local filesystem.
 * Web adapter:    Reads board definitions from bundled hals.json asset.
 *                 Orchestrator/agent list fetched from backend API.
 *                 Board preview images loaded from bundled assets.
 *
 * ## Editor IPC methods replaced:
 *   - window.bridge.getAvailableBoards()
 *   - window.bridge.getAvailableCommunicationPorts()
 *   - window.bridge.refreshAvailableBoards()
 *   - window.bridge.refreshCommunicationPorts()
 *   - window.bridge.getPreviewImage()
 *
 * ## Web service methods replaced:
 *   - Board data from bundled hals.json
 *   - Orchestrator list from orchestrator API
 *   - getDeviceStatus()
 */

import type { BoardInfo, CommunicationPort } from './types'

// ---------------------------------------------------------------------------
// Connect-time classification (D72) — platform contract shared by the port,
// its editor adapter, and the `deviceProbeInfo` store slice. The store can't
// reach into `backend/`, so the canonical shape lives here.
// ---------------------------------------------------------------------------

/** How a freshly-opened channel classified. */
export type DeviceProbeStatus = 'connected-with-firmware' | 'no-firmware' | 'no-response' | 'error'

/** On-device license state read (0x4A) for a licensable target. */
export type DeviceLicenseStatus = 'licensed' | 'unlicensed' | 'unsupported' | 'unknown'

export interface DeviceProbeResult {
  status: DeviceProbeStatus
  /** Present when a firmware answered 0x48: the raw hardware id, lowercase hex. */
  anchorHex?: string
  /** On-device license state — only present for a licensable connected device. */
  licenseStatus?: DeviceLicenseStatus
  error?: string
}

/**
 * Transport selector for a connect probe. `connectionType` picks the underlying
 * `LicenseCapableTransport` in the main process (serial RTU for USB boards, TCP,
 * or the runtime-v4 debug WebSocket). Fields not relevant to the chosen type are
 * ignored.
 */
export interface DeviceConnectParams {
  connectionType?: 'rtu' | 'tcp' | 'websocket'
  port?: string | number
  baudRate?: number
  slaveId?: number
  host?: string
  token?: string
}

/** What the connect-time recover step concluded (licensable targets only). */
export type DeviceActivationSummary = 'already-licensed' | 'activated' | 'demo' | 'unsupported' | 'error'

/**
 * Result of opening a persistent serial link (D72). Same classification as the
 * probe, plus what the auto-recover concluded — all done over a single held
 * client in the main process.
 */
export interface DeviceConnectResult {
  status: DeviceProbeStatus
  anchorHex?: string
  licenseStatus?: DeviceLicenseStatus
  activation?: DeviceActivationSummary
  error?: string
}

/** Outcome of a license activation attempt (0x48 -> derive -> backend -> 0x49). */
export type DeviceActivationOutcome = 'already-licensed' | 'activated' | 'demo' | 'error' | 'no-id'

export interface DeviceActivationResult {
  success: boolean
  probedAt: string
  outcome: DeviceActivationOutcome
  deviceId?: string
  vppId?: string
  anchorHex?: string
  license?: { present: boolean; empty?: boolean; corrupt?: boolean; unsupported?: boolean; blob?: number[] }
  error?: string
}

export interface DevicePort {
  /**
   * Get all available boards with their hardware specs and pin configurations.
   * Editor: reads from local HAL files + arduino-cli board list.
   * Web: reads from bundled hals.json + orchestrator device list.
   */
  getAvailableBoards(): Promise<Map<string, BoardInfo>>

  /**
   * Get available serial/communication ports.
   * Editor: queries local system serial ports.
   * Web: may not be applicable locally (ports come from remote device).
   */
  getCommunicationPorts(): Promise<CommunicationPort[]>

  /**
   * Refresh the board list (e.g., after installing a new arduino core).
   * Editor: re-scans arduino-cli and HAL files.
   * Web: re-fetches from backend/orchestrator.
   */
  refreshBoards(): Promise<Array<{ board: string; version: string }>>

  /**
   * Refresh communication ports list.
   * Editor: re-scans local system serial ports.
   * Web: re-queries orchestrator for available ports.
   */
  refreshCommunicationPorts(): Promise<CommunicationPort[]>

  /**
   * Get a board preview image for display in the UI.
   * Editor: loads image from local resources/ directory, returns base64 or file path.
   *         For VPP boards, loads from the package directory when packagePath is provided.
   * Web: returns URL to bundled image asset.
   */
  getPreviewImage(imageName: string, packagePath?: string): Promise<string>

  /**
   * License activation / auto-recover (D51/D62): open the channel, read the
   * hardware id (0x48) and any stored license (0x4A); when absent, derive the
   * device/VPP ids and ask the backend whether the device is licensed, writing
   * the returned blob (0x49). Best-effort — never throws; failures resolve to
   * `{ outcome: 'error' }`. Used by the CONNECT flow to silently recover a
   * license the backend already holds before prompting the user to buy.
   *
   * Editor: transient client picked by transport, same 0x48->0x4A->derive->
   * backend->0x49 on serial / TCP / runtime-v4 WebSocket.
   * Web: not applicable locally.
   */
  activateLicense(
    params: DeviceConnectParams,
    opts: { packageId: string; keyId?: string },
  ): Promise<DeviceActivationResult>

  /**
   * Open and HOLD a persistent serial link (D72). The main process keeps the
   * RTU client open with a liveness poll and pushes status changes; this call
   * returns the initial classification + recover result. Only meaningful for
   * serial (USB) targets. Editor: `device:connect`. Web: not applicable.
   */
  connect(
    params: DeviceConnectParams,
    opts?: { isLicensable?: boolean; packageId?: string; keyId?: string },
  ): Promise<DeviceConnectResult>

  /** Close a held serial link. Editor: `device:disconnect`. */
  disconnect(): Promise<{ success: boolean }>

  /**
   * Subscribe to live serial-link status pushed by the main process (liveness
   * failure, upload/debug handoff). Returns an unsubscribe function. Editor:
   * `device:connection-status` IPC event. Web: no-op.
   */
  onConnectionStatus(
    callback: (payload: {
      status: 'disconnected' | 'connecting' | 'connected' | 'error'
      port: string | null
    }) => void,
  ): () => void
}
