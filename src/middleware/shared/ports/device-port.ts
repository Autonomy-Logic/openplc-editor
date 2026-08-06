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
