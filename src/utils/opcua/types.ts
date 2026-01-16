/**
 * OPC-UA Configuration Types
 * Types used for OPC-UA config generation and index resolution.
 */

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
