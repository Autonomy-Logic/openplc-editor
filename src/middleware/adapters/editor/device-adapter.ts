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
  DeviceConnectParams,
  DeviceConnectResult,
  DevicePort,
  DeviceProbeResult,
} from '../../shared/ports/device-port'
import type { BoardInfo, CommunicationPort } from '../../shared/ports/types'

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

    connectProbe(params: DeviceConnectParams, opts?: { isLicensable?: boolean }): Promise<DeviceProbeResult> {
      return window.bridge.connectDeviceProbe(params, opts)
    },

    activateLicense(
      params: DeviceConnectParams,
      opts: { packageId: string; keyId?: string },
    ): Promise<DeviceActivationResult> {
      return window.bridge.activateDeviceLicense(params, opts)
    },

    connect(
      params: DeviceConnectParams,
      opts?: { isLicensable?: boolean; packageId?: string; keyId?: string },
    ): Promise<DeviceConnectResult> {
      return window.bridge.deviceConnect(params, opts)
    },

    disconnect(): Promise<{ success: boolean }> {
      return window.bridge.deviceDisconnect()
    },

    onConnectionStatus(
      callback: (payload: {
        status: 'disconnected' | 'connecting' | 'connected' | 'error'
        port: string | null
      }) => void,
    ): () => void {
      return window.bridge.onDeviceConnectionStatus(callback)
    },
  }
}
