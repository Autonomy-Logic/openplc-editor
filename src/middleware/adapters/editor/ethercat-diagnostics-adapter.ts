/**
 * Editor EtherCATDiagnosticsPort adapter.
 *
 * Transport-only.  Routes the diagnostics RPC through the Electron IPC bridge
 * (`window.bridge.etherCATDiagnostics`) to the main process, which POSTs
 * `/api/discovery/ethercat/diagnostics` on the configured runtime IP.  Response parsing
 * happens via the shared protocol helper so both the editor and web adapters interpret
 * the runtime reply the same way.
 */

import type { EtherCATDiagnosticsPort } from '../../shared/ports/ethercat-diagnostics-port'
import { parseDiagnosticsResponseBody } from '../../shared/utils/ethercat/diagnostics-protocol'

export interface EditorEtherCATDiagnosticsAdapterOptions {
  getRuntimeIp: () => string
}

export function createEditorEtherCATDiagnosticsAdapter(
  options: EditorEtherCATDiagnosticsAdapterOptions,
): EtherCATDiagnosticsPort {
  return {
    async pollDiagnostics(req) {
      try {
        const ip = options.getRuntimeIp()
        if (!ip) {
          return {
            success: false,
            error: 'No runtime IP configured. Connect to a runtime before polling diagnostics.',
          }
        }

        const result = await window.bridge.etherCATDiagnostics(ip, {
          busName: req.busName,
          slavePosition: req.slavePosition,
        })

        if (!result.success) {
          return { success: false, error: result.error ?? 'The runtime did not answer the diagnostics request.' }
        }

        return parseDiagnosticsResponseBody(result.data, { slavePosition: req.slavePosition })
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  }
}
