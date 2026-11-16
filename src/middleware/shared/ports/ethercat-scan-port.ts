/**
 * EtherCATScanPort: lists the modules a modular coupler reports through `0xF050` (ETG.5001),
 * slot by slot from 1. The editor adapter goes through the main process to the connected
 * runtime; the web adapter goes through the orchestrator. Both build the request and read the
 * reply with `middleware/shared/utils/ethercat/scan-modules-protocol.ts`. The Modules tab
 * matches the idents against the repository and checks each placement against the coupler's
 * `<Slots>` block before adding anything.
 */

import type { Result } from './types'

export interface ScanRequest {
  busName: string
  slavePosition: number
  /** The bus's network interface; the runtime scans through it when the bus is not uploaded yet. */
  networkInterface?: string
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
