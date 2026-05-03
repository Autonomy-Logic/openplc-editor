/**
 * OPC-UA Configuration Types
 * Types used for OPC-UA config generation and address resolution.
 */

/**
 * Represents a PLC instance (program instantiation in Resources).
 * Used to look up the instance name for a given program POU.
 */
export interface PLCInstanceInfo {
  /** Instance name (e.g., "INSTANCE0") - also the prefix STruC++ uses
   *  for leaf paths in debug-map.json. */
  name: string
  /** Task name this instance runs under */
  task: string
  /** Program POU name being instantiated */
  program: string
}

/**
 * A debug leaf parsed from STruC++'s debug-map.json. Replaces the
 * MatIEC-era flat-index DebugVariable. Each leaf is addressed by
 * (arr, elem) — array index plus element index into the per-project
 * Entry tables emitted by generated_debug.cpp.
 */
export interface DebugVariable {
  /** Hierarchical path from instance root, e.g.
   *  "INSTANCE0.MOTOR_SPEED" or "INSTANCE0.FB_INST.COUNTER" or
   *  "INSTANCE0.PROFILES[5]". Always uppercase per the codegen. */
  path: string
  /** IEC type tag name from debug_dispatch.hpp's TypeTag enum
   *  (e.g. "INT", "BOOL", "REAL"). */
  type: string
  /** Outer array index into debug_arrays[] (0 if no split). */
  arr: number
  /** Element index inside the chosen debug array. */
  elem: number
  /** Byte size from type_ops[tag].size. Useful for callers that
   *  pre-allocate read buffers. */
  size: number
}

/**
 * Resolved field information for structures.
 * Supports nested fields for complex types (FBs, structs within structs).
 */
export interface ResolvedField {
  name: string
  datatype: string
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
