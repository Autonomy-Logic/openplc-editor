/**
 * Editor EtherCATScanPort adapter — DOPE-704 E6 / RTOP-319 R3.
 *
 * Transport-only. Routes the modular-scan RPC through the Electron IPC bridge
 * (`window.bridge.etherCATScanModules`) to the main process, which POSTs
 * `/api/discovery/ethercat/scan-modules` on the configured runtime IP with the
 * JWT the renderer already holds. Response parsing happens via the shared
 * protocol helper so both the editor and web adapters interpret the runtime
 * reply the same way.
 */

import type { EtherCATScanPort } from '../../shared/ports/ethercat-scan-port'
import { parseScanModulesResponseBody } from '../../shared/utils/ethercat/scan-modules-protocol'

export interface EditorEtherCATScanAdapterOptions {
  getRuntimeIp: () => string
}

export function createEditorEtherCATScanAdapter(options: EditorEtherCATScanAdapterOptions): EtherCATScanPort {
  return {
    async scanModules(req) {
      try {
        const ip = options.getRuntimeIp()
        if (!ip) {
          return { success: false, error: 'No runtime IP configured. Connect to a runtime before scanning modules.' }
        }

        const result = await window.bridge.etherCATScanModules(ip, {
          busName: req.busName,
          slavePosition: req.slavePosition,
        })

        if (!result.success) {
          return { success: false, error: result.error ?? 'The runtime did not answer the scan-modules request.' }
        }

        return parseScanModulesResponseBody(result.data, { slavePosition: req.slavePosition })
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  }
}
