/**
 * Plain-JSON intermediate representation for an LD body.
 *
 * Mirrors what the existing DOM-based walker reads off the parsed
 * `<LD>` subtree, but as a structured-clonable JS object so the
 * walker stops touching `@xmldom`.  Both the openplc-web React Flow
 * adapter and the test-side XML→IR converter target this same shape
 * so the walker is verified against the same fixtures the DOM
 * walker uses today.
 */

export interface Position {
  x: number
  y: number
}

/** An incoming wire on a `connectionPointIn`. */
export interface Connection {
  refLocalId: number
  /** Disambiguates which output of a multi-output upstream block the
   *  connection reads (e.g. `"Q"` / `"ET"` on a TON). */
  refFormalParameter?: string
}

export interface ContactModifier {
  negated?: boolean
  edge?: 'rising' | 'falling'
}

export interface CoilModifier {
  negated?: boolean
  storage?: 'set' | 'reset'
  edge?: 'rising' | 'falling'
}

export interface BlockInputVar {
  formalParameter: string
  connections: Connection[]
}

export interface BlockOutputVar {
  formalParameter: string
}

export type LdInstance =
  | { kind: 'leftPowerRail'; localId: number; position: Position }
  | { kind: 'rightPowerRail'; localId: number; position: Position; connections: Connection[] }
  | {
      kind: 'contact'
      localId: number
      position: Position
      variable: string
      modifier: ContactModifier
      connections: Connection[]
    }
  | {
      kind: 'coil'
      localId: number
      position: Position
      variable: string
      modifier: CoilModifier
      connections: Connection[]
      executionOrderId?: number
    }
  | {
      kind: 'block'
      localId: number
      position: Position
      typeName: string
      instanceName?: string
      executionOrderId?: number
      inputs: BlockInputVar[]
      outputs: BlockOutputVar[]
      inOuts: BlockInputVar[]
    }
  | {
      kind: 'inVariable'
      localId: number
      position: Position
      expression: string
    }
  | {
      kind: 'outVariable'
      localId: number
      position: Position
      expression: string
      connections: Connection[]
      executionOrderId?: number
    }
  | {
      kind: 'inOutVariable'
      localId: number
      position: Position
      expression: string
      connections: Connection[]
    }
  | { kind: 'connector'; localId: number; position: Position; name: string; connections: Connection[] }
  | { kind: 'continuation'; localId: number; position: Position; name: string }

export interface LdBody {
  instances: LdInstance[]
}

/** O(1) lookup convenience: build once at the start of a walk. */
export function indexById(body: LdBody): Map<number, LdInstance> {
  const m = new Map<number, LdInstance>()
  for (const inst of body.instances) m.set(inst.localId, inst)
  return m
}

/** Stable narrowing predicate for the dispatch. */
export function instanceKind(inst: LdInstance): LdInstance['kind'] {
  return inst.kind
}
