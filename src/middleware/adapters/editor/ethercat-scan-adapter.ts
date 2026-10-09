/**
 * Editor EtherCATScanPort adapter — DOPE-704 E6.
 *
 * The Electron editor has no network path to EtherDOG's `scan-modules` endpoint today
 * (the local runtime bridge does not forward it). The adapter is deliberately a stub so
 * the UI can still render the Scan Modules button and surface a clear reason the action
 * is disabled; when the Electron bridge gains the forwarding the stub is a one-line
 * replace with the real bridge call.
 */

import type { EtherCATScanPort } from '../../shared/ports/ethercat-scan-port'

export function createEditorEtherCATScanAdapter(): EtherCATScanPort {
  return {
    async scanModules() {
      return {
        success: false,
        error:
          'Scan Modules is not available in the desktop editor yet. Connect through openplc-web (or wait for the Electron bridge to forward the EtherDOG scan command) to use this feature.',
      }
    },
  }
}
