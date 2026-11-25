/**
 * The values a screen can write to a PLC variable, as far as the build knows them statically: a two-way widget's
 * declared range (`hmi_range`) or text length (`hmi_max_length`) resolved from the element's literal properties, or the
 * literal a statement assigns. A runtime refuses written values outside them. Conditions in screen code (interlocks,
 * `IF` around an assignment) are not limits: they run only in the browser.
 */
import { maskStComments } from '@root/middleware/shared/utils/hmi/references'
import type { Expression } from 'strucpp'

import type { HmiWidgetInfo } from '../lib/widget-catalog'
import type { HmiElementDecl } from './screen-model'

/** Smallest and largest value a write may carry; for a STRING, its smallest and largest length in bytes. */
export interface HmiWriteLimit {
  min: number
  max: number
}

/** What a two-way element's NewValue can be, before it is converted to the variable's type. */
export type HmiElementLimit = { kind: 'range'; min: number; max: number } | { kind: 'length'; max: number }

const NUMBER = /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/
const TYPED_NUMBER = /^[A-Za-z_]+#([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)$/
const STRING = /^'((?:[^'$]|\$.)*)'$/
const LAST = /^last\(\s*([A-Za-z_]\w*)\s*\)$/i

/** The ST text an input starts from: the element's initializer, else the widget's default. */
function literalOf(element: HmiElementDecl, widget: HmiWidgetInfo, input: string): string | undefined {
  const own = element.props.get(input.toUpperCase())
  if (own !== undefined) return own.trim()
  return widget.properties.find((p) => p.name.toUpperCase() === input.toUpperCase())?.defaultValue?.trim()
}

/** Whether screen code changes an input of the element, so its start value is no limit. */
function assignedInCode(element: HmiElementDecl, input: string, code: string): boolean {
  return new RegExp(`\\b${element.name}\\s*\\.\\s*${input}\\s*:=`, 'i').test(code)
}

/** A number written as ST (`5`, `-2.5`, `REAL#3`), or undefined. */
function stNumber(text: string): number | undefined {
  const typed = TYPED_NUMBER.exec(text)
  const plain = typed ? typed[1] : text
  return NUMBER.test(plain) ? Number(plain) : undefined
}

/** Items of a `;` list as HMI_ListCount counts them. */
function listCount(text: string): number {
  return text.length === 0 ? 0 : text.split(';').length
}

/** One end of an `hmi_range`: a number, an input's literal value, or the last index of an input's list. */
function operand(text: string, element: HmiElementDecl, widget: HmiWidgetInfo, code: string): number | undefined {
  const direct = stNumber(text.trim())
  if (direct !== undefined) return direct
  const last = LAST.exec(text.trim())
  const input = last ? last[1] : text.trim()
  if (!/^[A-Za-z_]\w*$/.test(input) || assignedInCode(element, input, code)) return undefined
  const literal = literalOf(element, widget, input)
  if (literal === undefined) return undefined
  if (!last) return stNumber(literal)
  const list = STRING.exec(literal)
  return list ? Math.max(listCount(list[1]) - 1, 0) : undefined
}

/**
 * What a two-way element can write, or null when the build cannot bound it (no declared range, an input set by screen
 * code or not a literal).
 */
export function hmiElementLimit(
  element: HmiElementDecl,
  widget: HmiWidgetInfo,
  source: string,
): HmiElementLimit | null {
  const twoWay = widget.twoWay
  if (!twoWay) return null
  const code = maskStComments(source)
  if (twoWay.range) {
    const [lo, hi] = twoWay.range.split('..')
    if (hi === undefined) return null
    const a = operand(lo, element, widget, code)
    const b = operand(hi, element, widget, code)
    if (a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b)) return null
    return { kind: 'range', min: Math.min(a, b), max: Math.max(a, b) }
  }
  if (twoWay.maxLength) {
    const n = operand(twoWay.maxLength, element, widget, code)
    return n === undefined || n < 0 ? null : { kind: 'length', max: Math.floor(n) }
  }
  return null
}

type Literal = { kind: 'number'; value: number } | { kind: 'string'; bytes: number }

/** The literal an assignment's value is, through unary signs; undefined for any other expression. */
export function hmiLiteralOf(value: Expression): Literal | undefined {
  if (value.kind === 'UnaryExpression' && value.operator !== 'NOT') {
    const inner = hmiLiteralOf(value.operand)
    if (inner?.kind !== 'number') return undefined
    return value.operator === '-' ? { kind: 'number', value: -inner.value } : inner
  }
  if (value.kind !== 'LiteralExpression') return undefined
  if (value.literalType === 'BOOL') return { kind: 'number', value: value.value === true ? 1 : 0 }
  if ((value.literalType === 'INT' || value.literalType === 'REAL') && typeof value.value === 'number')
    return { kind: 'number', value: value.value }
  if (value.literalType === 'STRING' && typeof value.value === 'string')
    return { kind: 'string', bytes: new TextEncoder().encode(value.value).length }
  return undefined
}

/** The union of two limits; null (no limit) wins. */
export function hmiLimitUnion(a: HmiWriteLimit | null, b: HmiWriteLimit | null): HmiWriteLimit | null {
  if (a === null || b === null) return null
  return { min: Math.min(a.min, b.min), max: Math.max(a.max, b.max) }
}
