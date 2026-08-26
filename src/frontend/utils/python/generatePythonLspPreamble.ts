// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Build a Python preamble that declares the POU's IEC variables as
 * module-level globals — strictly for Pyright's view of the file,
 * never written to disk or shown in the Monaco editor.
 *
 * Why this exists.  The OpenPLC compiler injects shared-memory glue
 * around each Python POU body at build time (see
 * `injectPythonRuntime`): `input`/`output` IEC variables are
 * initialised at module scope and re-assigned each iteration from
 * `shm_in`, so a body like `def block_loop(): global red_light;
 * red_light = True` works at runtime.  Pyright, however, only ever
 * sees the user's raw editor text — none of that injected glue —
 * so it flags every `red_light` use as an undeclared name.
 *
 * The Python LSP integration prepends this preamble to the document
 * it ships to Pyright (the user's Monaco model stays untouched) and
 * subtracts `lineCount` from incoming diagnostic line numbers so the
 * resulting markers land back on user-facing lines.
 *
 * Returns an empty preamble (`text: ''`, `lineCount: 0`) when the
 * POU has no input/output variables — keeps the caller's prepend
 * logic uniform without a special case.
 */
import type { PLCDataType, PLCVariable } from '../../../middleware/shared/ports/types'
import { getArrayTotalElements, isArrayVariable } from '../PLC/array-codegen-helpers'
import { pythonInterfaceVariables } from './block-interface'

export interface PythonLspPreamble {
  /** Ready-to-prepend text, terminated by a newline (or empty). */
  text: string
  /** Number of model lines the preamble occupies; used to offset
   *  Pyright diagnostics back to the user's editor line numbering. */
  lineCount: number
  /**
   * Map from 0-indexed preamble line number → variable name for
   * every variable that survived to a declaration line in `text`.
   * The Python LSP definition-redirect uses this to translate a
   * Pyright Go-to-Definition target ("the declaration is at preamble
   * line N") into a variable name, which the IEC variable-text line
   * map then resolves to the matching VAR-block line in the user-
   * facing variables panel.  Empty when `lineCount === 0`.
   */
  variableNameByPreambleLine: Map<number, string>
}

/**
 * Map an IEC base-type name (`BOOL`, `INT`, …) to the Python type
 * annotation Pyright should see.  Returns `null` for unsupported
 * types (TIME / DATE / TOD / DT — currently not wired through the
 * Python runtime injection; if/when those land in `injectPython-
 * Runtime`, add the matching Python type here so the LSP catches up
 * automatically).  User-defined types and struct/enum data types
 * also return `null` — too rich to render as a single Python type
 * hint, and the runtime doesn't pack them across shared memory yet.
 */
function mapIecBaseTypeToPython(value: string): string | null {
  const upper = value.toUpperCase()
  if (upper === 'BOOL') return 'bool'
  if (
    upper === 'SINT' ||
    upper === 'INT' ||
    upper === 'DINT' ||
    upper === 'LINT' ||
    upper === 'USINT' ||
    upper === 'UINT' ||
    upper === 'UDINT' ||
    upper === 'ULINT' ||
    upper === 'BYTE' ||
    upper === 'WORD' ||
    upper === 'DWORD' ||
    upper === 'LWORD' ||
    upper === '__XWORD'
  ) {
    return 'int'
  }
  if (upper === 'REAL' || upper === 'LREAL') return 'float'
  if (upper === 'STRING' || upper === 'WSTRING') return 'str'
  // TIME / DATE / TOD / DT: not yet supported by `injectPythonRuntime` —
  // the runtime doesn't pack them across shared memory.  If/when those
  // types land in the runtime, extend the mapping here so Pyright
  // recognises them as the matching Python type.
  return null
}

/**
 * Default Python literal for a given Python type annotation.  Used
 * to give every declared variable an initial value so Pyright treats
 * it as a definite assignment (and consequently as a writable name
 * inside the user's `block_loop`).
 */
function defaultPythonLiteralFor(pythonType: string): string {
  if (pythonType === 'bool') return 'False'
  if (pythonType === 'int') return '0'
  if (pythonType === 'float') return '0.0'
  if (pythonType === 'str') return "''"
  // Unreachable in practice: `annotationFor` yields exactly these four scalar
  // annotations or `list[...]`, and `initialValueFor` handles the list case
  // before delegating here. Kept as a safety net rather than a throw, because a
  // preamble is a convenience for the editor — a wrong literal costs a Pyright
  // diagnostic, an exception would cost the user their type checking entirely.
  /* istanbul ignore next -- defensive: annotationFor cannot produce another value */
  return 'None'
}

/**
 * Build a Python type annotation string for a single IEC variable.
 * Returns `null` when the variable's type can't be mapped (struct,
 * enum, unsupported scalar, malformed array) — caller skips
 * declaring it rather than risk a Pyright diagnostic on the
 * preamble itself.
 */
function annotationFor(variable: PLCVariable): string | null {
  if (isArrayVariable(variable)) {
    const inner = variable.type.data?.baseType?.value
    if (!inner) return null
    const innerPython = mapIecBaseTypeToPython(inner)
    if (!innerPython) return null
    return `list[${innerPython}]`
  }
  if (variable.type.definition === 'user-data-type') {
    // A structure or an enumeration: the stub declared above carries its shape,
    // so the annotation is simply the class name. A type the project does not
    // declare — a function block instance — is refused at compile time and gets
    // no declaration here either.
    return variable.type.value
  }
  /* istanbul ignore next -- defensive: only base-type remains */
  if (variable.type.definition !== 'base-type') return null
  return mapIecBaseTypeToPython(variable.type.value)
}

/**
 * Build the initial value literal for a variable's Python
 * declaration.  Arrays initialise to `[default_inner] * count` so
 * Pyright sees a concrete `list[T]` populated to the array's IEC
 * length.  Scalars use a zero-of-type literal — the user's
 * `block_loop` reads/writes the live shared-memory value at
 * runtime; the preamble's literal is only there to satisfy
 * Pyright's "name has a value" requirement.
 */
function initialValueFor(variable: PLCVariable, annotation: string): string {
  if (annotation.startsWith('list[')) {
    const innerType = annotation.slice('list['.length, -1)
    const count = getArrayTotalElements(variable)
    const defaultInner = defaultPythonLiteralFor(innerType)
    return count > 0 ? `[${defaultInner}] * ${count}` : '[]'
  }
  return defaultPythonLiteralFor(annotation)
}

/**
 * Class stubs for the structures and enumerations a POU's interface uses.
 *
 * These mirror what `injectPythonRuntime` actually defines at runtime, so
 * Pyright resolves `m.speed` and `Mode.RUNNING` to the same shapes the block
 * will really see. Without them a structure variable has no type to be, and the
 * editor either says nothing useful or reports an error on correct code.
 *
 * The stub bodies are `...` rather than the runtime's real `__init__`: Pyright
 * only needs the attribute names and their types, and a shorter stub keeps the
 * preamble's line count — which the diagnostic line mapping depends on — small.
 */
function typeStubsFor(variables: PLCVariable[], dataTypes: readonly PLCDataType[]): string[] {
  if (dataTypes.length === 0) return []
  const byName = new Map(dataTypes.map((dataType) => [dataType.name.toUpperCase(), dataType]))
  const emitted = new Set<string>()
  const lines: string[] = []

  // `emitted` is what breaks a cycle: a structure that contains itself is
  // declared once and its member simply refers back to it, which is a legal
  // Python annotation and exactly what Pyright should see.
  const visit = (typeName: string): void => {
    const key = typeName.toUpperCase()
    if (emitted.has(key)) return
    const dataType = byName.get(key)
    if (!dataType || dataType.derivation === 'array') return
    emitted.add(key)

    if (dataType.derivation === 'enumerated') {
      lines.push(`class ${dataType.name}(IntEnum):`)
      dataType.values.forEach((value, index) => lines.push(`    ${value.description} = ${index}`))
      return
    }

    // Members first, so a nested structure is named before it is referenced.
    for (const member of dataType.variable) {
      if (member.type.definition === 'user-data-type') visit(member.type.value)
    }
    lines.push(`class ${dataType.name}:`)
    for (const member of dataType.variable) {
      const annotation = annotationFor({
        name: member.name,
        type: member.type,
        location: '',
        documentation: '',
      })
      lines.push(`    ${member.name}: ${annotation ?? 'Any'}`)
    }
  }

  // Only the variables that actually get a declaration below. An array of
  // structures has no Python annotation and is refused at compile time, so it
  // gets neither a declaration nor a stub — the editor stays in lockstep with
  // what the build will accept.
  for (const variable of variables) {
    if (variable.type.definition === 'user-data-type') visit(variable.type.value)
  }

  return lines.length > 0 ? ['from enum import IntEnum', 'from typing import Any', ...lines, ''] : []
}

/**
 * Generate the LSP-only preamble for a POU's variables.
 *
 * Every class `injectPythonRuntime` wires through shared memory gets a
 * declaration, because those are exactly the names the runtime binds as module
 * globals. `temp` is refused for a Python block and so is never one.
 *
 * The header comment makes it obvious in any debug snapshot that
 * the lines are a synthetic Pyright nudge, not user code.
 */
export function generatePythonLspPreamble(
  variables: PLCVariable[],
  dataTypes: readonly PLCDataType[] = [],
): PythonLspPreamble {
  const declarable = pythonInterfaceVariables(variables)
  if (declarable.length === 0) {
    return { text: '', lineCount: 0, variableNameByPreambleLine: new Map() }
  }

  const header = [
    '# ===================================================================',
    '# IEC variables — auto-generated for the Pyright language server.',
    '# Not part of the source file; the OpenPLC compiler injects these',
    '# names as module-level globals at runtime (see injectPythonRuntime).',
    '# ===================================================================',
  ]
  const declared = declarable.filter((variable) => annotationFor(variable) !== null)
  const typeStubs = typeStubsFor(declared, dataTypes)
  const declLines: string[] = []
  const variableNameByPreambleLine = new Map<number, string>()
  // First declaration sits at line `header.length` (header occupies
  // lines 0..header.length-1).  Each subsequent declaration advances
  // by one line.  Variables whose type can't be mapped to Python
  // (TIME / DATE / TOD / DT / user types) are skipped — they don't
  // get a declaration line, so they don't take a slot in the map.
  let preambleLine = header.length + typeStubs.length
  for (const v of declarable) {
    const annotation = annotationFor(v)
    if (!annotation) continue
    declLines.push(`${v.name}: ${annotation} = ${initialValueFor(v, annotation)}`)
    variableNameByPreambleLine.set(preambleLine, v.name)
    preambleLine++
  }
  if (declLines.length === 0) {
    return { text: '', lineCount: 0, variableNameByPreambleLine: new Map() }
  }

  const body = [...header, ...typeStubs, ...declLines, '', '']
  const text = body.join('\n')
  // `lineCount` is the 0-indexed augmented-document line where the
  // user's first line begins.  Equivalently: the number of newline
  // characters in `text`.  `body.join('\n')` produces `body.length -
  // 1` separators, so `lineCount = body.length - 1` — the trailing
  // empty segment of `body` becomes the same line as the user's
  // first character once we concatenate `preamble.text + userCode`,
  // not a line of its own.  Off-by-one here shifted hover positions
  // to the next line and would have surfaced as wrong-line markers
  // too once a diagnostic actually fired on the user's first line.
  return { text, lineCount: body.length - 1, variableNameByPreambleLine }
}
