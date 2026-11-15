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

/** The variables that can be wired to `main`. */
export function bindableVariables(main: HmiWidgetBinding, variables: readonly HmiPlcVariable[]): HmiPlcVariable[] {
  return variables.filter((v) => canBind(main, v.type))
}

/** A variable wired to a momentary output, and the value it takes while the output is on. */
export interface HmiMomentaryBinding {
  variable: string
  whilePressed: boolean
}

type Momentary = NonNullable<HmiWidgetInfo['momentary']>

const VARIABLE = '[A-Za-z_]\\w*\\s*\\.\\s*[A-Za-z_]\\w*'

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
