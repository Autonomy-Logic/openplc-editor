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

import type { BoardInfo, CommunicationPort, DebugConnectionConfig, DebugMedium, DeviceLinkTransport } from './types'

// ---------------------------------------------------------------------------
// Connect-time classification (D72) — platform contract shared by the port and
// its editor adapter. The store can't reach into `backend/`, so the canonical
// shape lives here.
// ---------------------------------------------------------------------------

/** How a freshly-opened channel classified. */
export type DeviceProbeStatus = 'connected-with-firmware' | 'no-firmware' | 'no-response' | 'error'

/**
 * Result of opening a persistent device link (D72): how the channel the main
 * process settled on classified.
 */
export interface DeviceConnectResult {
  status: DeviceProbeStatus
  /** Transport failure text when `status === 'error'`. */
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
  /**
   * Medium the CONTROL channel uses (or was using, when it dropped). Absent for a
   * REST-controlled runtime session: REST holds no connection.
   */
  transport?: DeviceLinkTransport
  /**
   * Medium the DEBUG channel uses — the same as `transport` when one channel serves
   * both roles, else `websocket` (editor / v4), `tcp` (v3), or `webrtc` /
   * `http-relay` in the browser. Consumers that must pace or size work to the wire
   * (the debug poll) read THIS, rather than inferring a medium they have no
   * business choosing.
   */
  debugTransport?: DebugMedium
  /**
   * The endpoint, as the user would name it: a serial path ("/dev/ttyACM0",
   * "COM5") or an IP address. Not called `port`, because for a Modbus TCP link it
   * is an address — and a name that implies serial is what led callers to branch
   * on the wrong thing in the first place.
   */
  descriptor?: string
  reason?: 'lost'
}

// ---------------------------------------------------------------------------
// VPP licensing over the held link
// ---------------------------------------------------------------------------

/**
 * What the licensing step concluded about a connected device.
 *
 * A discriminated union rather than a status string plus flags, so the three
 * things the UI may assert stay three separate variants. In particular
 * `unlicensed` (the backend says there is no purchase — demo is correct, offer to
 * buy) and `checkFailed` (we could not find out) must never be rendered the same
 * way: showing "Not licensed" for a rate-limited request tells someone who
 * already paid to buy again.
 *
 * `licensed` asserts POSSESSION of a well-formed license bound to this device and
 * this VPP — not that the closed license-core will run FULL. Only the core can say
 * that, so the badge says "Licensed", never "Full mode".
 */
export type DeviceLicenseState =
  /** A well-formed license bound to this device and this VPP is stored. */
  | { state: 'licensed'; how: 'already-stored' | 'activated' }
  /**
   * The device does NOT hold a valid license.
   *
   * `entitlementChecked` says how far we got, and the UI must branch on it:
   *   - `true`  — the backend was asked and reported no purchase for this device.
   *               Demo mode is correct and BUYING is the fix. `backendReason`
   *               carries the backend's own wording when it gave one.
   *   - `false` — we only know the device is holding nothing usable; nobody has
   *               asked whether a purchase exists. The fix to OFFER is "check for
   *               a license" (a refresh), not "buy" — telling someone who already
   *               paid to pay again is the worst outcome this union exists to
   *               prevent.
   */
  | { state: 'unlicensed'; entitlementChecked: boolean; backendReason?: string }
  /**
   * The running firmware reports no licence storage.
   *
   * On a licensable board this is a FIRMWARE fault, not a hardware limitation:
   * every licensable VPP targets hardware that persists a licence across a
   * reboot, so a board answering this was built without its storage backend.
   * The fix is always "rebuild and upload", never "buy a different board" —
   * which is why this variant carries no detail to vary the message with.
   */
  | { state: 'unsupported' }
  /**
   * Possession could not be determined. Never render as "not licensed".
   *
   * `retryable: false` marks the causes that cannot change by asking again —
   * a board whose architecture has no identity to bind a licence to, a firmware
   * answering an identity format this editor does not speak, a transport that
   * carries no licensing at all. Offering "Try Again" for those is a button
   * guaranteed to reproduce the same error, which reads as a flaky link and
   * sends the user retrying instead of doing the thing that would fix it.
   * Absent means retryable: a dropped connection, a timeout and a backend blip
   * are the common case, and they must keep their retry.
   */
  | { state: 'check-failed'; error: string; retryable?: boolean }

/** Result of a licensing operation over the held link. */
export interface DeviceLicenseReport {
  outcome: DeviceLicenseState
  /**
   * The licensing identity, 32 lowercase hex chars. Derived main-side (it needs
   * `node:crypto`), so the renderer cannot compute it and must be handed it: it
   * feeds the license popover, the copy button, and the buy deep link. Absent only
   * when there was no usable hardware anchor, which is itself a `checkFailed`.
   */
  deviceId?: string
}

/** Arguments both licensing calls take, resolved by `resolveLicensingTarget`. */
export interface DeviceLicenseRequest {
  /** Reverse-domain VPP package id (`package.id`). */
  packageId: string
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
   * Open and HOLD the connection to a baremetal device (D72).
   *
   * `candidates` is the ordered list of ways to reach it, resolved from the
   * board's debug spec: Modbus TCP first when the project enables it, then serial.
   * The main process tries them in order and keeps the first that both opens and
   * answers, so a stale DHCP address or an unplugged ethernet shield falls through
   * to the cable instead of leaving the editor claiming a connection it does not
   * have. It then holds that ONE connection — every command (debug, run/stop, the
   * status poll) rides it — polls it, and pushes status changes through
   * `onConnectionStatus`.
   *
   * Editor: `device:connect`. Web: not applicable locally.
   */
  connect(candidates: DebugConnectionConfig[]): Promise<DeviceConnectResult>

  /**
   * Establish a session with a target CONTROLLED over REST (Runtime v3/v4), after
   * the renderer has logged in: `debug` describes the channel that target debugs
   * over (v3 Modbus TCP, v4 the WebSocket), which is opened later, only if a debug
   * session asks for it.
   *
   * Editor: `session:open-runtime`. Web: no-op.
   */
  openRuntimeSession?(params: { address: string; debug: DebugConnectionConfig }): Promise<{
    success: boolean
    error?: string
  }>

  /** Close a REST-controlled session (logout / disconnect). */
  closeRuntimeSession?(): Promise<{ success: boolean }>

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
   * Ask the connected device what license it is holding RIGHT NOW: read FC 0x4A
   * and verify the bytes. Never contacts the backend, so it is cheap and safe to
   * call on a poll or a screen open.
   *
   * The verification is the point. A device answering `SUCCESS` does not mean the
   * stored license is good — the targets disagree about what they check first —
   * so a caller that trusted the status byte would show "Licensed" on a board
   * running demo.
   *
   * Optional: only platforms that hold a device link implement it. Editor:
   * `device:read-license`.
   */
  readLicense?(request: DeviceLicenseRequest): Promise<DeviceLicenseReport>

  /**
   * Run the FULL licensing flow over the held link: read, verify, and when the
   * device holds nothing usable, ask the backend and write what it returns
   * (re-reading to confirm).
   *
   * Separate from `readLicense` because this one can take seconds and reaches the
   * network — a connect must not block on it, and it is also what the UI calls
   * again after a purchase so a device gets its license without disconnecting or
   * reflashing.
   *
   * Optional: only platforms that hold a device link implement it. Editor:
   * `device:refresh-license`.
   */
  refreshLicense?(request: DeviceLicenseRequest): Promise<DeviceLicenseReport>

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
  onPlcState?(callback: (payload: { port: string; plcState?: number; switchPosition?: number }) => void): () => void
}
