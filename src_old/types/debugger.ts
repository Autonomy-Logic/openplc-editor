/**
 * Function Block Instance Info
 * Represents information about a specific FB instance for debugging
 */
export interface FbInstanceInfo {
  /** FB type name (e.g., "Calculate_PID", "TON") */
  fbTypeName: string

  /** Program POU name containing this instance (e.g., "main") */
  programName: string

  /** Instance name from Resources configuration (e.g., "INSTANCE0") */
  programInstanceName: string

  /** FB variable name in the program (e.g., "MOTOR_SPEED0") */
  fbVariableName: string

  /** Unique key for this instance: `${programName}:${fbVariableName}` */
  key: string
}

/**
 * Debug Tree Node Interface
 * Represents a node in the hierarchical debugger variable tree
 */
export interface DebugTreeNode {
  /** Display name (e.g., "TON0", "favorite_person", "name") */
  name: string

  /** Full debug path (e.g., "RES0__INSTANCE0.TON0.EN") */
  fullPath: string

  /** Editor key format (e.g., "main:TON0.EN") */
  compositeKey: string

  /** IEC type or "STRUCT", "ARRAY", "FB" */
  type: string

  /** true for arrays, structs, FBs */
  isComplex: boolean

  /** UI state for expansion */
  isExpanded?: boolean

  /** Sub-variables for complex types */
  children?: DebugTreeNode[]

  /** Only for leaf nodes - index in debug.c */
  debugIndex?: number

  /** For array nodes [start, end] */
  arrayIndices?: number[]
}
