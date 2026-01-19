/**
 * Re-exports from canonical debug-parser module.
 *
 * This file provides backwards compatibility for existing imports while
 * delegating to the shared debug-parser module.
 */

// Re-export everything from canonical parser
export {
  type DebugVariableEntry,
  type ParsedDebugData,
  parseDebugFile,
  parseDebugVariables,
} from '@root/utils/debug-parser'

// Type alias for backwards compatibility
export type DebugVariable = import('@root/utils/debug-parser').DebugVariableEntry
