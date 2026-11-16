/**
 * PlcModelPort — a typed read-only view of the PLC project model for consumers outside the editor
 * (notably VPP screens that need to list exportable variables).
 *
 * The implementation lives in `frontend/services/plc-model/`; the port is the contract the host-
 * query handler calls into when a VPP screen asks `getPlcVariables` or `getPlcAddress` over the
 * vendor-document relay.
 */

export type Unsubscribe = () => void

/**
 * Scope a Data Hub export belongs to. The compile pipeline and the host-query handler both carry
 * this alongside the flat wire qualifier so consumers do not have to parse strings to recover the
 * decomposition, and so an ambiguous name (e.g. a POU happening to be named `GVL`) does not
 * silently collapse into the global namespace.
 */
export type ExportableScope = { kind: 'program'; programName: string } | { kind: 'gvl'; listName: string }

/**
 * Shape of a PLC variable exposed to a VPP screen via `getPlcVariables` and to a runtime emitter
 * via its `model.exportableVariables` input. `qualifier` is the wire string the emitter contract
 * already consumes (`"P1.foo"` / `"GVL.bar"`); `scope` + `variable` carry the structured
 * decomposition so downstream code does not have to re-parse the string.
 */
export interface ExportableVariable {
  qualifier: string
  scope: ExportableScope
  variable: string
  type: string
  isWritable: boolean
}

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
