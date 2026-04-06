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
}
