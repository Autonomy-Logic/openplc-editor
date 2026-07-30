/**
 * Editor DevicePort adapter — delegates to Electron IPC bridge.
 *
 * Communicates with the main process HardwareModule which reads HAL
 * JSON files from resources/sources/boards/ and queries arduino-cli
 * for installed cores. Board preview images are returned as base64
 * data URIs from the local filesystem.
 *
 * IPC channels:
 *   hardware:get-available-boards              (invoke)
 *   hardware:get-available-communication-ports  (invoke)
 *   hardware:refresh-available-boards           (invoke)
 *   hardware:refresh-communication-ports        (invoke)
 *   util:get-preview-image                      (invoke)
 */

import type {
  DeviceActivationResult,
  DeviceConnectionStatusPayload,
  DeviceConnectParams,
  DeviceConnectResult,
  DevicePort,
} from '../../shared/ports/device-port'
import type { BoardInfo, CommunicationPort, DebugConnectionConfig } from '../../shared/ports/types'

export function createEditorDeviceAdapter(): DevicePort {
  return {
    getAvailableBoards(): Promise<Map<string, BoardInfo>> {
      return window.bridge.getAvailableBoards()
    },

    getCommunicationPorts(): Promise<CommunicationPort[]> {
      return window.bridge.getAvailableCommunicationPorts()
    },

    refreshBoards(): Promise<Array<{ board: string; version: string }>> {
      return window.bridge.refreshAvailableBoards()
    },

    refreshCommunicationPorts(): Promise<CommunicationPort[]> {
      return window.bridge.refreshCommunicationPorts()
    },

    getPreviewImage(imageName: string, packagePath?: string): Promise<string> {
      return window.bridge.getPreviewImage(imageName, packagePath)
    },

    activateLicense(
      params: DeviceConnectParams,
      opts: { packageId: string; keyId?: string },
    ): Promise<DeviceActivationResult> {
      return window.bridge.activateDeviceLicense(params, opts)
    },

    connect(
      candidates: DebugConnectionConfig[],
      opts?: { isLicensable?: boolean; packageId?: string; keyId?: string },
    ): Promise<DeviceConnectResult> {
      return window.bridge.deviceConnect(candidates, opts)
    },

    async releaseSerialPort(port: string | null | undefined): Promise<boolean> {
      const result = await window.bridge.deviceReleaseSerialPort(port)
      return result.released
    },

    disconnect(): Promise<{ success: boolean }> {
      return window.bridge.deviceDisconnect()
    },

    onLinkLog(callback: (message: string) => void): () => void {
      return window.bridge.onDeviceLinkLog(callback)
    },

    onConnectionStatus(callback: (payload: DeviceConnectionStatusPayload) => void): () => void {
      return window.bridge.onDeviceConnectionStatus(callback)
    },

    onPlcState(
      callback: (payload: { port: string; plcState?: number; switchPosition?: number }) => void,
    ): () => void {
      return window.bridge.onDevicePlcState(callback)
    },
  }
}
