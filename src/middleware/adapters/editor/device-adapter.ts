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

import type { DevicePort } from '../../shared/ports/device-port'
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
  }
}
