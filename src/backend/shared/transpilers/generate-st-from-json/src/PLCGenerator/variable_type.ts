/**
 * Variable / literal type inference.
 *
 * Mirrors `PouProgramGenerator.GetVariableType` (PLCGenerator.py:786) plus
 * the literal-prefix handling from `ComputeConnectionTypes`
 * (PLCGenerator.py:1001-1011).
 *
 * **Phase 2b.1 scope**: single-name Interface lookup only. Dot-path
 * traversal (struct fields, block I/O via `GetBlockType` /
 * `GetDataTypeInfos`) is deferred until the block library lands in
 * Phase 2d — the current corpus exercises no dotted expressions, so the
 * shortcut is observable in the golden.
 */

import type { ProjectTree } from '../plcopen/plcopen'
import type { Element } from '../xmlclass/xsdschema'
import { GetBlockType } from './block_library'
import { ComputeDataTypeName, GetDataTypeInfos } from './data_type'
import type { InterfaceEntry } from './interface'
import { LITERAL_TYPES } from './type_text'

/**
 * Resolve a variable reference (possibly dotted) to its declared type.
 *
 * Returns the type string (e.g. `"BOOL"`, `"TIME"`, `"Irrigation_State"`)
 * or `null` when no declaration matches.
 *
 * Algorithm — mirrors `PouProgramGenerator.GetVariableType`
 * (PLCGenerator.py:786):
 *
 *   1. Split on dots. Resolve the **head** against the POU Interface
 *      (Python iterates the full Interface without an outer-loop break, so
 *      the LAST matching variable wins — preserved here even though the
 *      corpus has no duplicates).
 *   2. For each remaining `.field` part, try in order:
 *        - `GetBlockType(currentType)` — if it's a function-block instance
 *          type, look the part up in its inputs ∪ outputs.
 *        - `GetDataTypeInfos("D::" + currentType)` — if it resolves to a
 *          Structure, look the part up in its elements.
 *      Mismatch ends traversal with `null`.
 *
 * `project` is the parsed project tree, required for dot-path traversal.
 * `null` skips the dot-path walk (head Interface lookup still runs).
 */
export function getVariableType(
  iface: InterfaceEntry[],
  name: string,
  project: ProjectTree | Element | null = null,
): string | null {
  const parts = name.split('.')
  if (parts.length === 0) return null
  const head = parts.shift() as string
  let currentType: string | null = null
  for (const entry of iface) {
    for (const v of entry.vars) {
      if (v.name === head) {
        currentType = v.type
        break // matches Python's inner-loop-only `break`
      }
    }
  }

  while (currentType !== null && parts.length > 0 && project !== null) {
    const blocktype = GetBlockType(project, currentType)
    if (blocktype !== null) {
      const part = parts.shift() as string
      currentType = null
      for (const io of [...blocktype.inputs, ...blocktype.outputs]) {
        if (io.name === part) {
          currentType = io.type
          break
        }
      }
      continue
    }

    const infos = GetDataTypeInfos(project, ComputeDataTypeName(currentType))
    if (infos !== null && infos.type === 'Structure') {
      const part = parts.shift() as string
      currentType = null
      for (const element of infos.elements) {
        if (element.Name === part) {
          // Python assigns whatever `element["Type"]` is — a string for
          // most fields, a `('array', ...)` tuple for inline arrays.
          // We only continue traversal when it's a string; the tuple
          // form terminates further dot-path lookup (matches Python's
          // implicit failure on `GetBlockType(tuple)`).
          currentType = typeof element.Type === 'string' ? element.Type : null
          break
        }
      }
      continue
    }

    // Neither FB nor Structure — can't traverse further.
    break
  }

  return currentType
}

/**
 * Resolve a literal expression to its IEC type, or `null` when it's not a
 * literal we recognize. Used by the `InVariable` / `OutVariable` branch of
 * `ComputeConnectionTypes` after `getVariableType` fails — the variable
 * reference might actually be a literal like `T#500ms` or `'hello'`.
 *
 * Mirrors PLCGenerator.py:1001-1011:
 *   - prefix split on `#` → look up in LITERAL_TYPES; fall back to the
 *     prefix verbatim if the table has no mapping
 *   - single-quoted string → `"STRING"`
 *   - double-quoted string → `"WSTRING"`
 */
export function literalType(expression: string): string | null {
  if (expression.includes('#')) {
    const prefix = expression.split('#', 1)[0].toUpperCase()
    if (prefix in LITERAL_TYPES) return LITERAL_TYPES[prefix]
    return prefix
  }
  if (expression.startsWith("'")) return 'STRING'
  if (expression.startsWith('"')) return 'WSTRING'
  return null
}

/**
 * Combined variable-or-literal resolution. The Python pipeline runs the
 * Interface lookup first and only falls through to literal detection when
 * the variable name is not declared. Provided here as a convenience.
 *
 * `project` enables dot-path resolution inside `getVariableType`; pass `null`
 * to skip the walk (head Interface lookup still runs).
 */
export function resolveExpressionType(
  iface: InterfaceEntry[],
  expression: string,
  project: ProjectTree | Element | null = null,
): string | null {
  const declared = getVariableType(iface, expression, project)
  if (declared !== null) return declared
  return literalType(expression)
}
