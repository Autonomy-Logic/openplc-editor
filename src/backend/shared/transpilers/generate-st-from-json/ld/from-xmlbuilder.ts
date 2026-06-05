/**
 * Convert an xmlbuilder2 plain-object body subtree (the shape
 * `ladderToXml` / `fbdToXml` in `frontend/utils/PLC/xml-generator/`
 * produce) into the JSON-native `LdBody` IR consumed by the LD/FBD
 * walker.
 *
 * Conventions mirrored:
 *   - `'@attr'` keys → attribute values
 *   - `key: {…}` → single child element
 *   - `key: [{…}, {…}]` → repeated child elements
 *
 * Lives in openplc-web because the production adapter calls
 * `ladderToXml(rungs)` first (the existing React Flow → XML path)
 * then runs this converter to get the IR the worker expects.
 * Phase 4 (post-this-integration) replaces the two-step
 * ladderToXml + xmlbuilder→IR with a single React Flow → IR
 * converter, dropping ladder-xml.ts as a dependency.
 */

import type { Connection, LdBody, LdInstance, Position } from './types'

type Obj = Record<string, unknown>

/* ─────────────────────────── public entry ───────────────────────────────── */

/**
 * Accepts the wrapper object `ladderToXml` or `fbdToXml` returns
 * (`{ body: { LD: {…} } }` or `{ body: { FBD: {…} } }`) and walks
 * the inner body content, materialising one `LdInstance` per child
 * element.
 */
export function xmlObjectToLdBody(wrapper: Record<string, unknown>): LdBody {
  const body = asObject(wrapper.body)
  if (!body) return { instances: [] }
  const inner = asObject(body.LD) ?? asObject(body.FBD)
  if (!inner) return { instances: [] }

  const instances: LdInstance[] = []
  for (const [tag, value] of Object.entries(inner)) {
    if (tag.startsWith('@') || tag === '$') continue
    for (const child of asElementArray(value)) {
      const inst = elementToInstance(tag, child)
      if (inst) instances.push(inst)
    }
  }
  return { instances }
}

/* ─────────────────────────── per-tag parsers ────────────────────────────── */

function elementToInstance(tag: string, el: Obj): LdInstance | null {
  const localId = getAttrInt(el, 'localId')
  if (localId === undefined) return null
  const position = getPosition(el)

  if (tag === 'leftPowerRail') {
    return { kind: 'leftPowerRail', localId, position }
  }
  if (tag === 'rightPowerRail') {
    return {
      kind: 'rightPowerRail',
      localId,
      position,
      connections: collectConnections(el),
    }
  }
  if (tag === 'contact') {
    return {
      kind: 'contact',
      localId,
      position,
      variable: getTextChild(el, 'variable'),
      modifier: buildContactModifier(el),
      connections: collectConnections(el),
    }
  }
  if (tag === 'coil') {
    const eoid = getAttrInt(el, 'executionOrderId')
    const result: LdInstance = {
      kind: 'coil',
      localId,
      position,
      variable: getTextChild(el, 'variable'),
      modifier: buildCoilModifier(el),
      connections: collectConnections(el),
    }
    if (eoid !== undefined) (result as { executionOrderId?: number }).executionOrderId = eoid
    return result
  }
  if (tag === 'block') {
    const inputsEl = asObject(el.inputVariables)
    const outputsEl = asObject(el.outputVariables)
    const inOutsEl = asObject(el.inOutVariables)
    const inputs = readBlockVariables(inputsEl)
    const outputs = readBlockVariables(outputsEl).map((v) => ({ formalParameter: v.formalParameter }))
    const inOuts = readBlockVariables(inOutsEl)
    const eoid = getAttrInt(el, 'executionOrderId')
    const instName = getAttrString(el, 'instanceName')
    const result: LdInstance = {
      kind: 'block',
      localId,
      position,
      typeName: getAttrString(el, 'typeName') ?? '',
      inputs,
      outputs,
      inOuts,
    }
    if (instName !== undefined) (result as { instanceName?: string }).instanceName = instName
    if (eoid !== undefined) (result as { executionOrderId?: number }).executionOrderId = eoid
    return result
  }
  if (tag === 'inVariable') {
    return {
      kind: 'inVariable',
      localId,
      position,
      expression: getTextChild(el, 'expression'),
    }
  }
  if (tag === 'outVariable') {
    const eoid = getAttrInt(el, 'executionOrderId')
    const result: LdInstance = {
      kind: 'outVariable',
      localId,
      position,
      expression: getTextChild(el, 'expression'),
      connections: collectConnections(el),
    }
    if (eoid !== undefined) (result as { executionOrderId?: number }).executionOrderId = eoid
    return result
  }
  if (tag === 'inOutVariable') {
    return {
      kind: 'inOutVariable',
      localId,
      position,
      expression: getTextChild(el, 'expression'),
      connections: collectConnections(el),
    }
  }
  if (tag === 'connector') {
    return {
      kind: 'connector',
      localId,
      position,
      name: getAttrString(el, 'name') ?? '',
      connections: collectConnections(el),
    }
  }
  if (tag === 'continuation') {
    return {
      kind: 'continuation',
      localId,
      position,
      name: getAttrString(el, 'name') ?? '',
    }
  }
  return null
}

/* ─────────────────────────── helpers ────────────────────────────────────── */

function asObject(v: unknown): Obj | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Obj
  return null
}

function asElementArray(v: unknown): Obj[] {
  if (Array.isArray(v)) {
    return v.filter((item): item is Obj => item !== null && typeof item === 'object' && !Array.isArray(item))
  }
  if (v && typeof v === 'object') return [v as Obj]
  return []
}

function getAttrString(el: Obj, name: string): string | undefined {
  const v = el[`@${name}`]
  if (v === undefined || v === null) return undefined
  return String(v)
}

function getAttrInt(el: Obj, name: string): number | undefined {
  const s = getAttrString(el, name)
  if (s === undefined) return undefined
  const n = Number.parseInt(s, 10)
  return Number.isFinite(n) ? n : undefined
}

function getAttrBool(el: Obj, name: string): boolean {
  return getAttrString(el, name) === 'true'
}

function getTextChild(el: Obj, key: string): string {
  const v = el[key]
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  if (v && typeof v === 'object') {
    // xmlbuilder2 uses `'$'` for text content; tolerate it.
    const obj = v as Obj
    const dollar = obj.$ ?? obj['#text']
    if (typeof dollar === 'string') return dollar
  }
  return ''
}

function getPosition(el: Obj): Position {
  const pos = asObject(el.position)
  if (!pos) return { x: 0, y: 0 }
  return { x: getAttrInt(pos, 'x') ?? 0, y: getAttrInt(pos, 'y') ?? 0 }
}

function collectConnections(el: Obj): Connection[] {
  // `connectionPointIn` can be a single object (most instances) or
  // an array (rightPowerRail / coil with multiple parallel inputs).
  const cpIns = asElementArray(el.connectionPointIn)
  const out: Connection[] = []
  for (const cpIn of cpIns) {
    for (const conn of asElementArray(cpIn.connection)) {
      const ref = getAttrInt(conn, 'refLocalId')
      if (ref === undefined) continue
      const fp = getAttrString(conn, 'formalParameter')
      const result: Connection = { refLocalId: ref }
      if (fp !== undefined) result.refFormalParameter = fp
      out.push(result)
    }
  }
  return out
}

function buildContactModifier(el: Obj): { negated?: boolean; edge?: 'rising' | 'falling' } {
  const mod: { negated?: boolean; edge?: 'rising' | 'falling' } = {}
  if (getAttrBool(el, 'negated')) mod.negated = true
  const edge = getAttrString(el, 'edge')
  if (edge === 'rising' || edge === 'falling') mod.edge = edge
  return mod
}

function buildCoilModifier(el: Obj): { negated?: boolean; storage?: 'set' | 'reset'; edge?: 'rising' | 'falling' } {
  const mod: { negated?: boolean; storage?: 'set' | 'reset'; edge?: 'rising' | 'falling' } = {}
  if (getAttrBool(el, 'negated')) mod.negated = true
  const storage = getAttrString(el, 'storage')
  if (storage === 'set' || storage === 'reset') mod.storage = storage
  const edge = getAttrString(el, 'edge')
  if (edge === 'rising' || edge === 'falling') mod.edge = edge
  return mod
}

function readBlockVariables(wrap: Obj | null): { formalParameter: string; connections: Connection[] }[] {
  if (!wrap) return []
  const out: { formalParameter: string; connections: Connection[] }[] = []
  for (const v of asElementArray(wrap.variable)) {
    out.push({
      formalParameter: getAttrString(v, 'formalParameter') ?? '',
      connections: collectConnections(v),
    })
  }
  return out
}
