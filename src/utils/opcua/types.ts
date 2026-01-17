/**
 * OPC-UA Configuration Types
 * Types used for OPC-UA config generation and index resolution.
 */

/**
 * Represents a PLC instance (program instantiation in Resources).
 * Used to look up the instance name for a given program POU.
 */
export interface PLCInstanceInfo {
  /** Instance name (e.g., "INSTANCE0") - this appears in debug.c */
  name: string
  /** Task name this instance runs under */
  task: string
  /** Program POU name being instantiated */
  program: string
}

/**
 * Represents a debug variable parsed from debug.c
 */
export interface DebugVariable {
  /** Full variable path (e.g., "RES0__INSTANCE0.MOTOR_SPEED") */
  name: string
  /** IEC type (e.g., "INT", "BOOL", "REAL") */
  type: string
  /** Index in the debug_vars array */
  index: number
}

/**
 * Resolved field information for structures
 */
export interface ResolvedField {
  name: string
  datatype: string
  initialValue: boolean | number | string
  index: number
  permissions: {
    viewer: 'r' | 'w' | 'rw'
    operator: 'r' | 'w' | 'rw'
    engineer: 'r' | 'w' | 'rw'
  }
}
