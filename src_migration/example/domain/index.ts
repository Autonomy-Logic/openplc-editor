// Public entry of the domain layer. Other layers import only from here, never from the files behind it.
export { checkIdentifier, type IdentifierViolation, sameIdentifier } from './identifier'
export {
  EMPTY_VARIABLE_DOCUMENT,
  isVariableType,
  type Variable,
  VARIABLE_TYPES,
  type VariableDocument,
  type VariableType,
} from './variable'
export {
  addVariable,
  isConsistentDocument,
  removeVariable,
  renameVariable,
  type VariableRuleResult,
  type VariableRuleViolation,
} from './variable-document'
