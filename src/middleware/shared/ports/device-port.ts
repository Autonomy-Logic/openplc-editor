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

import type { BoardInfo, CommunicationPort, DebugConnectionConfig } from './types'

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
  /**
   * The licensing identity, `sha256("openplc-dev-v1|" || anchor)[:16]` hex —
   * what the backend stores a license against, and what a purchase must be
   * bound to. Distinct from `anchorHex` (the raw hardware serial): the two are
   * NOT interchangeable and must not be labelled the same in the UI. Derived in
   * the main process (`node:crypto`), so the renderer receives it rather than
   * computing it.
   */
  deviceId?: string
  /** On-device license state — only present for a licensable connected device. */
  licenseStatus?: DeviceLicenseStatus
  /**
   * What the license check CONCLUDED, which is not the same question as
   * `licenseStatus` (what is stored on the device). The pair that matters:
   * `unlicensed` + `demo` means the backend confirmed there is no license,
   * while `unlicensed` + `error` means we never got an answer — the request was
   * throttled, the signer was unconfigured, the network was down. Telling those
   * apart is the difference between "buy a license" and "we could not check".
   */
  activation?: DeviceActivationSummary
  /** Transport/backend failure text when `activation === 'error'`. */
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
  /** See `DeviceProbeResult.deviceId` — the licensing identity, not the anchor. */
  deviceId?: string
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
  /**
   * The same two fields the serial connect result carries. `outcome` alone is
   * lossy — it folds "no on-device storage" and "the backend never answered"
   * into a single `'error'`, which is why the network path used to show a
   * different (or blank) badge than serial for the same device.
   */
  licenseStatus?: DeviceLicenseStatus
  activation?: DeviceActivationSummary
  deviceId?: string
  vppId?: string
  anchorHex?: string
  license?: { present: boolean; empty?: boolean; corrupt?: boolean; unsupported?: boolean; blob?: number[] }
  error?: string
}

/**
 * Live status of the held baremetal serial link, pushed by the main process.
 *
 * `reason: 'lost'` distinguishes the one failure the user must be TOLD about — a
 * link that was up, died, and could not be recovered — from an 'error' that came
 * straight out of something they just clicked (which already has its own dialog).
 */
export interface DeviceConnectionStatusPayload {
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  /** Which transport the connection uses (or was using, when it dropped). */
  transport?: 'rtu' | 'tcp' | 'simulator'
  /**
   * The endpoint, as the user would name it: a serial path ("/dev/ttyACM0",
   * "COM5") or an IP address. Not called `port`, because for a Modbus TCP link it
   * is an address — and a name that implies serial is what led callers to branch
   * on the wrong thing in the first place.
   */
  descriptor?: string
  reason?: 'lost'
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
   * Open and HOLD the connection to a baremetal device (D72).
   *
   * `candidates` is the ordered list of ways to reach it, resolved from the
   * board's debug spec: Modbus TCP first when the project enables it, then serial.
   * The main process tries them in order and keeps the first that both opens and
   * answers, so a stale DHCP address or an unplugged ethernet shield falls through
   * to the cable instead of leaving the editor claiming a connection it does not
   * have. It then holds that ONE connection — every command (debug, run/stop, the
   * status poll, licensing) rides it — polls it, and pushes status changes through
   * `onConnectionStatus`.
   *
   * Editor: `device:connect`. Web: not applicable locally.
   */
  connect(
    candidates: DebugConnectionConfig[],
    opts?: { isLicensable?: boolean; packageId?: string; keyId?: string },
  ): Promise<DeviceConnectResult>

  /**
   * Hand the serial port over for an upload: releases the held connection only if
   * it IS the serial one occupying `port`, and reports whether it did.
   *
   * A connection over Modbus TCP is left alone — flashing over USB does not
   * disturb it, so debugging and run/stop survive the upload. Disconnecting
   * unconditionally (what the upload flow used to do) threw away a working link
   * for no reason.
   *
   * Editor: `device:release-serial-port`. Web: no-op, returns false.
   */
  releaseSerialPort(port: string | null | undefined): Promise<boolean>

  /** Close a held serial link. Editor: `device:disconnect`. */
  disconnect(): Promise<{ success: boolean }>

  /**
   * Subscribe to live serial-link status pushed by the main process (liveness
   * failure, upload/debug handoff). Returns an unsubscribe function. Editor:
   * `device:connection-status` IPC event. Web: no-op.
   */
  /**
   * Subscribe to the device connection's diagnostic trace. Returns an unsubscribe
   * function. Editor: `device:link-log`. Web: no-op.
   */
  onLinkLog?(callback: (message: string) => void): () => void

  onConnectionStatus(callback: (payload: DeviceConnectionStatusPayload) => void): () => void

  /**
   * Subscribe to run/stop state from the held device link (baremetal targets).
   *
   * Pushed on the same liveness tick that keeps the link honest — the status
   * frame (FC 0x46) carries the run/stop state and the mode-switch position — so
   * this costs no extra round trip and needs no second timer. `plcState` is
   * 0/1/2 (STOPPED/RUNNING/ERROR); `switchPosition` is 0/1 (STOP/RUN) and is
   * absent on firmware predating the run/stop state machine.
   */
  onPlcState?(
    callback: (payload: { port: string; plcState?: number; switchPosition?: number }) => void,
  ): () => void
}
