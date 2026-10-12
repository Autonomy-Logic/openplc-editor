/**
 * Port for polling live modular-coupler diagnostics from the runtime.  The underlying
 * contract is a POST to `/api/discovery/ethercat/diagnostics` on the runtime, which asks
 * EtherDOG to read the coupler's status word (bits 6 and 7 of its device-state register)
 * and each module's status byte via CoE SDOs.  The shape here is transport-independent;
 * only the adapter changes between editor (IPC) and web (orchestrator proxy).
 */

import type { Result } from './types'

export interface DiagnosticsRequest {
  busName: string
  /** 1-based slave position on the EtherCAT bus. */
  slavePosition: number
}

/**
 * Interpretation of the coupler's status word plus per-slot status bytes.  All numbers
 * are the raw values the runtime returned; decoding into human-readable warnings happens
 * in the shared decoder (see decode-diagnostics.ts).
 */
export interface CouplerDiagnostics {
  /** Raw status word; bit 6 = configuration mismatch, bit 7 = never written. */
  statusWord: number
  /** Timestamp (epoch ms) when the runtime read the status. */
  pollAt: number
}

export interface ModuleDiagnostics {
  slot: number
  /** Raw status byte from `0x80n0:04` for each module (ETG.5001). */
  statusByte: number
}

export interface DiagnosticsSnapshot {
  coupler: CouplerDiagnostics
  modules: ModuleDiagnostics[]
}

export interface EtherCATDiagnosticsPort {
  pollDiagnostics(request: DiagnosticsRequest): Promise<Result<{ snapshot: DiagnosticsSnapshot }>>
}
