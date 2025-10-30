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
