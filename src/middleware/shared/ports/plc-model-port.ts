/**
 * PlcModelPort — a typed read-only view of the PLC project model for consumers outside the editor
 * (notably VPP screens that need to list exportable variables). Added by the RTOP-306 PoC.
 *
 * The implementation lives in `frontend/services/plc-model/`; the port is the contract the host-
 * query handler calls into when a VPP screen asks `getPlcVariables` or `getPlcAddress` over the
 * vendor-document relay.
 */

import type { ExportableVariable } from '../vendor-document/protocol'

export type Unsubscribe = () => void

export interface PlcModelPort {
  /** All variables a VPP screen may expose over the Data Hub (POU locals, globals, inouts). */
  listExportableVariables(): ReadonlyArray<ExportableVariable>
  /** Resolve a qualifier (e.g. `Program0.pump_speed`) to its IEC address, or `''` when unlocated. */
  resolveAddress(qualifier: string): string
  /**
   * Subscribe to changes in the parts of the project model this port exposes (POU variables,
   * global variables, GVLs). Fires once per store commit that changes any of them.
   */
  onModelChanged(callback: () => void): Unsubscribe
}
