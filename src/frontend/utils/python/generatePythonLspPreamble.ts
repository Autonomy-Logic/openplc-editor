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
  // `Any` reaches here, and `None` is assignable to it. Every other annotation
  // — `list[...]`, a structure, an enumeration — is resolved by
  // `initialValueFor` before it delegates, so those never arrive.
  //
  // This used to carry an `istanbul ignore` claiming it was unreachable. It was
  // not: a structure or enumeration variable annotated `Motor` fell straight
  // through the four scalars to `None`, and the preamble declared
  // `m: Motor = None` — which Pyright correctly rejects, putting a spurious
  // error on correct user code for the commonest composite case.
  return 'None'
}

/** The project's data types, indexed the way every other lookup indexes them. */
const indexTypes = (dataTypes: readonly PLCDataType[]): Map<string, PLCDataType> =>
  new Map(dataTypes.map((dataType) => [dataType.name.toUpperCase(), dataType]))

/**
 * Build a Python type annotation string for a single IEC variable.
 * Returns `null` when the variable's type can't be mapped at all — caller skips
 * declaring it rather than risk a Pyright diagnostic on the preamble itself.
 *
 * A user-defined type is resolved through `dataTypes` rather than echoed back:
 *
 *   - the annotation is the type's OWN declared spelling, because that is what
 *     `typeStubsFor` names the class. Echoing the variable's spelling meant
 *     `m : MOTOR` against a type declared `Motor` annotated a class that does
 *     not exist, and Pyright reported `"MOTOR" is not defined` on generated
 *     code the user cannot see or fix.
 *   - a name the project does not declare becomes `Any`. It gets a declaration
 *     either way, so the name resolves while the user is still typing, but it
 *     cannot name a class with no stub behind it.
 */
function annotationFor(variable: PLCVariable, dataTypes: readonly PLCDataType[] = []): string | null {
  if (isArrayVariable(variable)) {
    const inner = variable.type.data?.baseType?.value
    if (!inner) return null
    const innerPython = mapIecBaseTypeToPython(inner)
    if (!innerPython) return null
    return `list[${innerPython}]`
  }
  if (variable.type.definition === 'user-data-type') {
    const declared = indexTypes(dataTypes).get(variable.type.value.toUpperCase())
    if (!declared || declared.derivation === 'array') return 'Any'
    return declared.name
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
function initialValueFor(variable: PLCVariable, annotation: string, dataTypes: readonly PLCDataType[] = []): string {
  if (annotation.startsWith('list[')) {
    const innerType = annotation.slice('list['.length, -1)
    const count = getArrayTotalElements(variable)
    const defaultInner = defaultPythonLiteralFor(innerType)
    return count > 0 ? `[${defaultInner}] * ${count}` : '[]'
  }
  // A class annotation needs a value of that class, not `None`. Pyright is right
  // to reject `m: Motor = None`, and the user sees the complaint on a line the
  // preamble wrote.
  //
  // A structure stub declares members as annotations and no `__init__`, so
  // `Motor()` constructs and type-checks. An enumeration cannot be called, so it
  // takes its first member — which is also the value the PLC starts it at.
  const declared = indexTypes(dataTypes).get(annotation.toUpperCase())
  if (declared?.derivation === 'structure') return `${declared.name}()`
  if (declared?.derivation === 'enumerated') {
    const first = declared.values[0]?.description
    return first ? `${declared.name}.${first}` : 'Any'
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
      const annotation = annotationFor(
        {
          name: member.name,
          type: member.type,
          location: '',
          documentation: '',
        },
        dataTypes,
      )
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
  const declared = declarable.filter((variable) => annotationFor(variable, dataTypes) !== null)
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
    const annotation = annotationFor(v, dataTypes)
    if (!annotation) continue
    declLines.push(`${v.name}: ${annotation} = ${initialValueFor(v, annotation, dataTypes)}`)
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
