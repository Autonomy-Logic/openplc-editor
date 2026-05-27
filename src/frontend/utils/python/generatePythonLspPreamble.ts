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
import type { PLCVariable } from '../../../middleware/shared/ports/types'
import { getArrayTotalElements, isArrayVariable } from '../PLC/array-codegen-helpers'

export interface PythonLspPreamble {
  /** Ready-to-prepend text, terminated by a newline (or empty). */
  text: string
  /** Number of model lines the preamble occupies; used to offset
   *  Pyright diagnostics back to the user's editor line numbering. */
  lineCount: number
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
    upper === 'LWORD'
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
  // list[...] or any other compound — empty list is the safest no-op
  // initial value Pyright accepts as compatible with the annotation.
  if (pythonType.startsWith('list[')) return '[]'
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
  if (variable.type.definition !== 'base-type') {
    // user-data-type (struct / enum) — runtime injection doesn't
    // pack these across shared memory today; skip silently.
    return null
  }
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
 * Generate the LSP-only preamble for a POU's variables.  Only
 * `input` and `output` IEC variables get a declaration — those are
 * the classes `injectPythonRuntime` wires through shared memory and
 * therefore the only ones the runtime will actually expose as
 * module-level globals.  Local / temp / inOut / external classes
 * are intentionally skipped so Pyright doesn't pretend symbols
 * exist that the runtime won't bind.
 *
 * The header comment makes it obvious in any debug snapshot that
 * the lines are a synthetic Pyright nudge, not user code.
 */
export function generatePythonLspPreamble(variables: PLCVariable[]): PythonLspPreamble {
  const declarable = variables.filter((v) => v.class === 'input' || v.class === 'output')
  if (declarable.length === 0) {
    return { text: '', lineCount: 0 }
  }

  const declLines: string[] = []
  for (const v of declarable) {
    const annotation = annotationFor(v)
    if (!annotation) continue
    declLines.push(`${v.name}: ${annotation} = ${initialValueFor(v, annotation)}`)
  }
  if (declLines.length === 0) {
    return { text: '', lineCount: 0 }
  }

  const header = [
    '# ===================================================================',
    '# IEC variables — auto-generated for the Pyright language server.',
    '# Not part of the source file; the OpenPLC compiler injects these',
    '# names as module-level globals at runtime (see injectPythonRuntime).',
    '# ===================================================================',
  ]
  const body = [...header, ...declLines, '', '']
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
  return { text, lineCount: body.length - 1 }
}
