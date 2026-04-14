import { v4 as uuidv4 } from 'uuid'

import type { PLCVariable } from '../../middleware/shared/ports/types'
import { parseIecStringToVariables } from './generate-iec-string-to-variables'

// --- Types -------------------------------------------------------------------

export type AIParsedCode =
  | { kind: 'full-pou'; variables: PLCVariable[]; body: string }
  | { kind: 'snippet'; body: string }

export type VariableMergeResult = {
  merged: PLCVariable[]
  added: PLCVariable[]
  modified: { existing: PLCVariable; incoming: PLCVariable }[]
}

// --- Detection ---------------------------------------------------------------

const POU_DECLARATION_RE = /^\s*(PROGRAM|FUNCTION_BLOCK|FUNCTION)\s+\w+/im
const VAR_BLOCK_RE = /\b(VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR_EXTERNAL|VAR_TEMP|VAR_GLOBAL|VAR)\b/i
const END_VAR_RE = /\bEND_VAR\b/gi
const END_POU_RE = /\b(END_PROGRAM|END_FUNCTION_BLOCK|END_FUNCTION)\b/i

// --- Helpers -----------------------------------------------------------------

/**
 * Find the index immediately after the last END_VAR in `text`, searching from `startIndex`.
 * Returns -1 if no END_VAR is found.
 */
function findLastEndVarIndex(text: string, startIndex: number): number {
  let lastIndex = -1
  END_VAR_RE.lastIndex = startIndex
  let match: RegExpExecArray | null
  while ((match = END_VAR_RE.exec(text)) !== null) {
    lastIndex = match.index + match[0].length
  }
  return lastIndex
}

// --- Parser ------------------------------------------------------------------

/**
 * Parse AI-generated IEC 61131-3 code into structured components.
 *
 * Detects whether the code is a full POU (with PROGRAM/FUNCTION_BLOCK/FUNCTION wrapper)
 * or a plain snippet, then extracts variables and body accordingly.
 */
export function parseAIGeneratedCode(code: string): AIParsedCode {
  const trimmed = code.trim()

  // Case 1: Full POU with wrapper keywords
  if (POU_DECLARATION_RE.test(trimmed)) {
    return parseFullPou(trimmed)
  }

  // Case 2: Standalone VAR blocks without a POU wrapper
  if (VAR_BLOCK_RE.test(trimmed) && !POU_DECLARATION_RE.test(trimmed)) {
    return parseVarBlocksWithBody(trimmed)
  }

  // Case 3: Plain snippet
  return { kind: 'snippet', body: trimmed }
}

/**
 * Parse a full POU string (PROGRAM/FUNCTION/FUNCTION_BLOCK wrapper).
 * Extracts variables and body, discarding the wrapper keywords.
 */
function parseFullPou(code: string): AIParsedCode {
  // Find the declaration line end
  const declMatch = code.match(POU_DECLARATION_RE)
  if (!declMatch) return { kind: 'snippet', body: code }

  const afterDecl = (declMatch.index ?? 0) + declMatch[0].length

  // Check for return type on function declarations (FUNCTION name : TYPE)
  let bodyStartIndex = afterDecl
  const afterDeclText = code.slice(afterDecl)
  const returnTypeMatch = afterDeclText.match(/^\s*:\s*\w+/)
  if (returnTypeMatch) {
    bodyStartIndex = afterDecl + returnTypeMatch[0].length
  }

  // Extract variable blocks
  let variables: PLCVariable[] = []
  const varStart = code.slice(bodyStartIndex).search(VAR_BLOCK_RE)

  if (varStart !== -1) {
    const varAbsStart = bodyStartIndex + varStart
    const lastEndVar = findLastEndVarIndex(code, varAbsStart)

    if (lastEndVar !== -1) {
      const varSection = code.slice(varAbsStart, lastEndVar)
      try {
        variables = parseIecStringToVariables(varSection)
        bodyStartIndex = lastEndVar
      } catch {
        // If variable parsing fails, keep bodyStartIndex unchanged so the VAR text is included in body
      }
    }
  }

  // Extract body (between last END_VAR and END_PROGRAM/END_FUNCTION/END_FUNCTION_BLOCK)
  const bodySlice = code.slice(bodyStartIndex)
  const endMatch = bodySlice.search(END_POU_RE)
  const body = endMatch !== -1 ? bodySlice.slice(0, endMatch).trim() : bodySlice.trim()

  return { kind: 'full-pou', variables, body }
}

/**
 * Parse standalone VAR blocks (no POU wrapper).
 * Extracts variables and treats the remaining text as body.
 */
function parseVarBlocksWithBody(code: string): AIParsedCode {
  const varStart = code.search(VAR_BLOCK_RE)
  if (varStart === -1) return { kind: 'snippet', body: code }

  const lastEndVar = findLastEndVarIndex(code, varStart)
  if (lastEndVar === -1) return { kind: 'snippet', body: code }

  const varSection = code.slice(varStart, lastEndVar)
  let variables: PLCVariable[] = []
  try {
    variables = parseIecStringToVariables(varSection)
  } catch {
    return { kind: 'snippet', body: code }
  }

  // Text before and after VAR blocks is the body
  const beforeVars = code.slice(0, varStart).trim()
  const afterVars = code.slice(lastEndVar).trim()
  const body = [beforeVars, afterVars].filter(Boolean).join('\n')

  if (variables.length === 0) {
    return { kind: 'snippet', body: code }
  }

  return { kind: 'full-pou', variables, body }
}

// --- Variable Merge ----------------------------------------------------------

/**
 * Merge incoming AI-generated variables with existing POU variables.
 *
 * - Existing variables keep their IDs, locations, debug flags.
 * - New variables get fresh UUIDs.
 * - Variables with the same name but different type/initial value are flagged as modified.
 */
export function mergeVariables(existing: PLCVariable[], incoming: PLCVariable[]): VariableMergeResult {
  const added: PLCVariable[] = []
  const modified: VariableMergeResult['modified'] = []

  // Build lookup by lowercase name for case-insensitive matching
  const existingByName = new Map<string, PLCVariable>()
  for (const v of existing) {
    existingByName.set(v.name.toLowerCase(), v)
  }

  const merged = [...existing]

  for (const inc of incoming) {
    const key = inc.name.toLowerCase()
    const ex = existingByName.get(key)

    if (!ex) {
      // New variable
      const newVar: PLCVariable = { ...inc, id: uuidv4() }
      added.push(newVar)
      merged.push(newVar)
    } else if (!variablesEqual(ex, inc)) {
      // Modified variable — keep existing ID/location/debug, update type/class/initialValue
      modified.push({ existing: ex, incoming: inc })
      const idx = merged.findIndex((v) => v.name.toLowerCase() === key)
      if (idx !== -1) {
        merged[idx] = {
          ...ex,
          class: inc.class ?? ex.class,
          type: inc.type,
          initialValue: inc.initialValue ?? ex.initialValue,
        }
      }
    }
    // else: unchanged — keep existing as-is
  }

  return { merged, added, modified }
}

function variablesEqual(a: PLCVariable, b: PLCVariable): boolean {
  return (
    a.type.definition === b.type.definition &&
    a.type.value === b.type.value &&
    (a.class ?? 'local') === (b.class ?? 'local') &&
    (a.initialValue ?? null) === (b.initialValue ?? null)
  )
}
