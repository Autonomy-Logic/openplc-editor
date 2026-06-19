/**
 * OPC-UA Configuration Types
 * Types used for OPC-UA config generation and address resolution.
 *
 * Variable identity / debug-path resolution piggybacks on the
 * debugger's shared types (debug-parser.ts + debug-variable-finder.ts).
 * The debugger maps user variable paths to (arr, elem) addresses on
 * the debug Entry tables; OPC-UA does exactly the same lookup, so
 * there's a single source of truth for both.
 */

/**
 * Represents a PLC instance (program instantiation in Resources).
 * Mirrors the debugger's PLCInstanceMapping but adds the `task` field
 * the OPC-UA config flow plumbs through.
 */
export interface PLCInstanceInfo {
  /** Instance name (e.g., "INSTANCE0") - the prefix STruC++ uses
   *  for leaf paths in debug-map.json. */
  name: string
  /** Task name this instance runs under */
  task: string
  /** Program POU name being instantiated */
  program: string
}

/**
 * Resolved field information for structures.
 * Supports nested fields for complex types (FBs, structs within structs).
 */
export interface ResolvedField {
  name: string
  /** Canonical IEC type from the compiler's debug map for leaves; the
   *  stored container type (FB/struct name) for complex parents. */
  datatype: string
  /** Canonical byte width from the compiler — null for complex parents
   *  (no leaf of their own; only their child leaves carry a size). */
  size: number | null
  /** Address of the leaf — null for complex types whose own address
   *  doesn't make sense (only their child leaves do). */
  arr: number | null
  elem: number | null
  permissions: {
    viewer: 'r' | 'w' | 'rw'
    operator: 'r' | 'w' | 'rw'
    engineer: 'r' | 'w' | 'rw'
  }
  /** Nested fields for complex types (FB instances, nested structs) */
  fields?: ResolvedField[]
}
