/**
 * EtherCATScanPort — DOPE-704 E6.
 *
 * Scans a bus's modular couplers to list the modules the coupler reports via `0xF050`
 * (ETG.5001). The response is parsed into a {@link ScanResponse} the editor hands to the
 * E6 reconciliation helpers (`reconcileScannedModules`, `applyScanReconciliation`).
 *
 * The port is minimal and focused because the scan path is architecturally different per
 * runtime:
 *   - **Editor adapter** has no network path to EtherDOG (the Electron editor talks to a
 *     local runtime over IPC but EtherDOG's scan isn't exposed yet). It returns a
 *     not-available error so the UI can still render the button and give the operator a
 *     clear reason the action is disabled.
 *   - **Web adapter** forwards through the orchestrator / fake orchestrator to EtherDOG's
 *     `scan-modules` command (RTOP-319 R3). In the dev-local build it returns a fixture
 *     from the dev store so the UI flow is testable without a bus.
 *
 * The parse-and-reconcile logic lives on the shared surface
 * (`middleware/shared/utils/ethercat/scan-reconcile.ts`), so the UI calls:
 *   const r = await scan.scanModules(bus, slave)
 *   if (!r.success) toast(r.error); else apply(reconcileScannedModules(r.scan, device.modules))
 */

import type { Result } from './types'

export interface ScanRequest {
  busName: string
  slavePosition: number
}

export interface ScanResponse {
  slavePosition: number
  modules: { slot: number; ident: string }[]
}

export interface EtherCATScanPort {
  /**
   * Send a `scan-modules` request to the runtime for the given bus's slave. Returns the
   * decoded scan on success, or a human-readable reason on failure (not-connected, no
   * EtherDOG, scan unsupported on this runtime version, slave not modular, etc.).
   */
  scanModules(req: ScanRequest): Promise<Result<{ scan: ScanResponse }>>
}
