/**
 * Port for polling live modular-coupler diagnostics from the runtime.  The underlying
 * contract is a POST to `/api/discovery/ethercat/diagnostics` on the runtime, which asks
 * EtherDOG to read the coupler's status bits (`0xF100`) and each configured module's state
 * (`0xA0n0:01`) via CoE SDOs.  The shape here is transport-independent; only the adapter
 * changes between editor (IPC) and web (orchestrator proxy).
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
  /** The 16 status bits of `0xF100`, or null when EtherDOG could not read them. */
  statusWord: number | null
  /** Timestamp (epoch ms) when the runtime read the status. */
  pollAt: number
}

export interface ModuleDiagnostics {
  slot: number
  /** Sub-index 1 of the module's `0xA0n0` object, or null when EtherDOG could not read it. */
  statusByte: number | null
}

export interface DiagnosticsSnapshot {
  coupler: CouplerDiagnostics
  modules: ModuleDiagnostics[]
}

export interface EtherCATDiagnosticsPort {
  pollDiagnostics(request: DiagnosticsRequest): Promise<Result<{ snapshot: DiagnosticsSnapshot }>>
}
