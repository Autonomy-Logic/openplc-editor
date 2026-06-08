/**
 * Narrowing helpers — read the loosely-typed `data: Record<string, unknown>`
 * payload on `RFNode` into a structured shape the walker can consume
 * without `as` casts.
 *
 * Each helper returns `null` when the payload doesn't match the
 * expected shape so the walker can decide whether to warn or skip.
 * Forward-compatible: extra fields are ignored, missing optional
 * fields default to safe values.
 */

import type { CoilModifier, ContactModifier } from '../core/modifier-types'

export type ContactVariant = 'default' | 'negated' | 'risingEdge' | 'fallingEdge'
export type CoilVariant = ContactVariant | 'set' | 'reset'
export type PowerRailSide = 'left' | 'right'
export type VariableVariant = 'input' | 'output' | 'inout'
export type BlockKind = 'function' | 'function-block' | 'function-block-instance'

export interface ContactData {
  variant: ContactVariant
  variable: string
}

export interface CoilData {
  variant: CoilVariant
  variable: string
  executionOrder: number
}

export interface PowerRailData {
  variant: PowerRailSide
}

export interface VariableData {
  variant: VariableVariant
  variable: string
  executionOrder: number
  block?: { id: string; handleId: string }
}

export interface ConnectorData {
  name: string
}

export interface ContinuationData {
  name: string
}

export interface BlockData {
  typeName: string
  blockKind: BlockKind
  instanceName: string
  /** Editor-assigned numeric localId — string of digits.  Feeds the
   *  `_TMP_<type><numericId>_<param>` temp-var naming and the
   *  PLCOpen `@localId` round-trip. */
  numericId: string
  executionOrder: number
  executionControl: boolean
  /** Extensible-input flag — when true, multiple edges may target a
   *  single declared input handle; the editor's XML serializer emits
   *  one `<variable>` per edge (`fbd-xml.ts:67`), and the python
   *  oracle then collapses them into "for each occurrence of the
   *  formal parameter in the variable list, use the LAST connected
   *  variable's expression" (`PLCGenerator.py:1498`). */
  extensible: boolean
  /** Declared input formal-parameter names, in declaration order. */
  inputs: string[]
  /** Declared output formal-parameter names, in declaration order. */
  outputs: string[]
}

export interface VariableExpression {
  expression: string
}

export interface ParallelData {
  side: 'open' | 'close'
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function asBoolean(v: unknown): boolean {
  return v === true
}

function readVariableName(v: unknown): string {
  if (!isObject(v)) return ''
  const name = v['name']
  return typeof name === 'string' ? name : ''
}

export function asContactData(data: Record<string, unknown>): ContactData | null {
  const variant = data['variant']
  if (variant !== 'default' && variant !== 'negated' && variant !== 'risingEdge' && variant !== 'fallingEdge')
    return null
  return { variant, variable: readVariableName(data['variable']) }
}

export function asCoilData(data: Record<string, unknown>): CoilData | null {
  const variant = data['variant']
  if (
    variant !== 'default' &&
    variant !== 'negated' &&
    variant !== 'risingEdge' &&
    variant !== 'fallingEdge' &&
    variant !== 'set' &&
    variant !== 'reset'
  )
    return null
  const eo = asNumber(data['executionOrder'])
  return {
    variant,
    variable: readVariableName(data['variable']),
    executionOrder: eo ?? 0,
  }
}

export function asPowerRailData(data: Record<string, unknown>): PowerRailData | null {
  const variant = data['variant']
  if (variant !== 'left' && variant !== 'right') return null
  return { variant }
}

export function asVariableData(data: Record<string, unknown>): VariableData | null {
  // Two variant shapes coexist in real-world fixtures:
  //   - LD per-case + serialized LD bodies: 'input' / 'output' / 'inout'
  //   - Modern FBD bodies: 'input-variable' / 'output-variable' / 'inout-variable'
  // Both serialize to the same PLCOpen XML element; map both to the
  // short form so downstream code only sees one vocabulary.
  const rawVariant = data['variant']
  let variant: VariableVariant
  if (rawVariant === 'input' || rawVariant === 'input-variable') variant = 'input'
  else if (rawVariant === 'output' || rawVariant === 'output-variable') variant = 'output'
  else if (rawVariant === 'inout' || rawVariant === 'inout-variable') variant = 'inout'
  else return null
  const out: VariableData = {
    variant,
    variable: readVariableName(data['variable']),
    executionOrder: asNumber(data['executionOrder']) ?? 0,
  }
  const block = data['block']
  if (isObject(block)) {
    const id = asString(block['id'])
    const handleId = asString(block['handleId'])
    if (id !== null && handleId !== null) out.block = { id, handleId }
  }
  return out
}

export function asConnectorData(data: Record<string, unknown>): ConnectorData | null {
  const name = asString(data['name'])
  if (name === null) return null
  return { name }
}

export function asContinuationData(data: Record<string, unknown>): ContinuationData | null {
  const name = asString(data['name'])
  if (name === null) return null
  return { name }
}

export function asParallelData(data: Record<string, unknown>): ParallelData | null {
  const t = data['type']
  if (t !== 'open' && t !== 'close') return null
  return { side: t }
}

export function asBlockData(data: Record<string, unknown>): BlockData | null {
  const variant = data['variant']
  if (!isObject(variant)) return null
  const typeName = asString(variant['name'])
  if (typeName === null) return null
  const rawKind = variant['type']
  const blockKind: BlockKind =
    rawKind === 'function-block' || rawKind === 'function-block-instance' ? 'function-block-instance' : 'function'
  const inputs: string[] = []
  const outputs: string[] = []
  const variables = variant['variables']
  if (Array.isArray(variables)) {
    for (const v of variables) {
      if (!isObject(v)) continue
      const name = asString(v['name'])
      if (name === null) continue
      const cls = v['class']
      if (cls === 'input') inputs.push(name)
      else if (cls === 'output') outputs.push(name)
      // `inOut` (also written `'inout'` in some shapes) is a single
      // formal parameter that the call site binds as an input *and*
      // the caller can read post-call as an output.  For call-site
      // emission both the python oracle and the editor's XML
      // serializer treat it as an input slot (the binding appears in
      // the argument list as `<param> := <source>`), so we list it
      // under `inputs` in source order — VAR_IN_OUT typically appears
      // before VAR_INPUT in the declaration, which is the order the
      // call site emits.
      else if (cls === 'inOut' || cls === 'inout') inputs.push(name)
    }
  }
  const rawNumericId = data['numericId']
  const numericId =
    typeof rawNumericId === 'string'
      ? rawNumericId
      : typeof rawNumericId === 'number' && Number.isFinite(rawNumericId)
        ? String(rawNumericId)
        : ''
  return {
    typeName,
    blockKind,
    instanceName: readVariableName(data['variable']),
    numericId,
    executionOrder: asNumber(data['executionOrder']) ?? 0,
    executionControl: asBoolean(data['executionControl']),
    extensible: asBoolean(variant['extensible']),
    inputs,
    outputs,
  }
}

/** inVariable / outVariable / inOutVariable carry an `expression`
 *  string (variable name OR literal OR free-form expression). */
export function asVariableExpressionData(data: Record<string, unknown>): VariableExpression | null {
  const expression = asString(data['expression'])
  if (expression === null) return null
  return { expression }
}

export function contactModifierFromVariant(variant: ContactVariant): ContactModifier {
  const mod: ContactModifier = {}
  if (variant === 'negated') mod.negated = true
  else if (variant === 'risingEdge') mod.edge = 'rising'
  else if (variant === 'fallingEdge') mod.edge = 'falling'
  return mod
}

export function coilModifierFromVariant(variant: CoilVariant): CoilModifier {
  const mod: CoilModifier = {}
  if (variant === 'negated') mod.negated = true
  else if (variant === 'risingEdge') mod.edge = 'rising'
  else if (variant === 'fallingEdge') mod.edge = 'falling'
  else if (variant === 'set') mod.storage = 'set'
  else if (variant === 'reset') mod.storage = 'reset'
  return mod
}
