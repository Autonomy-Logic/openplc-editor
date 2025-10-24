import { PLCVariable } from './open-plc'

/**
 * Composite key for identifying a variable reference in the system.
 * Replaces the previous UUID-based identification.
 */
export type VariableReference = {
  pouName: string
  variableName: string
  variableType: PLCVariable['type']
}

/**
 * Normalized form for lookups and comparisons.
 * Names are converted to lowercase for case-insensitive matching.
 */
export type NormalizedVariableReference = {
  pouName: string
  variableName: string
  variableType: PLCVariable['type']
}

/**
 * Scope determines where to search for variables.
 */
export type VariableScope = 'local' | 'global'

/**
 * Extended reference that includes scope information.
 */
export type ScopedVariableReference = VariableReference & {
  scope: VariableScope
}

/**
 * Replaces the current LadderBlockConnectedVariables type.
 * Removes handleTableId (ID-based) and uses name+type instead.
 */
export type BlockConnectedVariable = {
  handleName: string
  type: 'input' | 'output'
  variableRef: VariableReference | null
  variable: PLCVariable | undefined
}

export type BlockConnectedVariables = BlockConnectedVariable[]

/**
 * Replaces the current variable field in node data.
 * Used for contacts, coils, and block instances.
 */
export type ElementVariableAssociation = {
  ref: VariableReference
  variable: PLCVariable | undefined
  isValid: boolean
  validationError?: string
}
