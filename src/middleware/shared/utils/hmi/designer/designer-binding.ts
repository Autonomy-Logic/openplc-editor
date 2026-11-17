/**
 * Wiring a PLC variable to a widget's main input or output: which variables fit, and how a momentary output (a push
 * button's Pressed) is written as ST, `IF B.Changed THEN V := B.Pressed; END_IF;` or with NOT for FALSE while pressed.
 */
import type { HmiPlcVariable, HmiWidgetBinding, HmiWidgetInfo } from '../../../ports/hmi-preview-types'

const NUMERIC: ReadonlySet<string> = new Set([
  'SINT',
  'INT',
  'DINT',
  'LINT',
  'USINT',
  'UINT',
  'UDINT',
  'ULINT',
  'BYTE',
  'WORD',
  'DWORD',
  'LWORD',
  'REAL',
  'LREAL',
])

/** Upper-case elementary type, with STRING(n) as STRING. */
const baseType = (type: string): string => {
  const t = type.trim().toUpperCase()
  return /^STRING\s*([([]\s*\d+\s*[)\]])?$/.test(t) ? 'STRING' : t
}

/** Whether a variable of `type` can be wired to `main`: the same type, or any number to a numeric input. */
export function canBind(main: HmiWidgetBinding, type: string): boolean {
  const want = baseType(main.type)
  const have = baseType(type)
  if (want === have) return true
  return main.direction === 'input' && NUMERIC.has(want) && NUMERIC.has(have)
}

/** Whether a widget's main binding writes the variable: an output, an input the operator changes, or a momentary output. */
export function writesMain(info: Pick<HmiWidgetInfo, 'main' | 'twoWay' | 'momentary'>): boolean {
  return info.main?.direction === 'output' || info.twoWay !== undefined || info.momentary !== undefined
}

/** Why a binding that writes may not write `variable`, or null when it may: constants and block outputs are read-only. */
export function readOnlyReason(variable: HmiPlcVariable): string | null {
  if (variable.constant) return `${variable.path} is a CONSTANT`
  if (variable.blockOutput) return `${variable.path} is an output of a function block`
  return null
}

/** The variables that can be wired to `main`; read-only ones only when the binding never writes. */
export function bindableVariables(
  main: HmiWidgetBinding,
  variables: readonly HmiPlcVariable[],
  writes: boolean,
): HmiPlcVariable[] {
  return variables.filter((v) => canBind(main, v.type) && !(writes && readOnlyReason(v) !== null))
}

/**
 * Why `variable` cannot be wired to the main binding of `element`, a widget of `info`, or null when it can: a read-only
 * variable on a binding that writes, or a type the binding does not take. An unknown variable is left to the build.
 */
export function bindRefusal(
  element: string,
  info: Pick<HmiWidgetInfo, 'main' | 'twoWay' | 'momentary'>,
  path: string,
  variable: HmiPlcVariable | undefined,
): string | null {
  const main = info.main
  if (!main) return `${element} has no input a variable can show`
  if (!variable) return null
  const readOnly = writesMain(info) ? readOnlyReason(variable) : null
  if (readOnly !== null) return `${readOnly}; ${element} would write it`
  if (!canBind(main, variable.type)) return `${element}.${main.name} takes ${main.type}; ${path} is ${variable.type}`
  return null
}

/** A variable wired to a momentary output, and the value it takes while the output is on. */
export interface HmiMomentaryBinding {
  variable: string
  whilePressed: boolean
}

type Momentary = NonNullable<HmiWidgetInfo['momentary']>

/** A global, `List.Member` or `Instance.Program.Var`: identifiers joined by dots, with integer subscripts. */
const VARIABLE = '[A-Za-z_]\\w*(?:\\s*\\.\\s*[A-Za-z_]\\w*|\\s*\\[\\s*-?\\d+(?:\\s*,\\s*-?\\d+)*\\s*\\])*'

/** The binding an element's `Changed` code is, or null when the code is anything else. */
export function momentaryOf(code: string, element: string, momentary: Momentary): HmiMomentaryBinding | null {
  const pattern = new RegExp(`^(${VARIABLE})\\s*:=\\s*(NOT\\s+)?([A-Za-z_]\\w*)\\s*\\.\\s*([A-Za-z_]\\w*)\\s*;?$`, 'i')
  const m = pattern.exec(code.trim())
  if (!m) return null
  if (m[3].toUpperCase() !== element.toUpperCase() || m[4].toUpperCase() !== momentary.value.toUpperCase()) return null
  return { variable: m[1].replace(/\s+/g, ''), whilePressed: m[2] === undefined }
}

/** The statement run on the frames the output flips. */
export function momentaryCode(element: string, momentary: Momentary, binding: HmiMomentaryBinding): string {
  return `${binding.variable} := ${binding.whilePressed ? '' : 'NOT '}${element}.${momentary.value};`
}
