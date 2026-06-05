/**
 * Plain-JSON IR for an SFC body — steps, transitions, jumps,
 * action blocks, divergences.  Drives the JSON-native walker the
 * same way `ld/types.ts` drives the LD/FBD walker.
 *
 * Sub-POUs (transition reference bodies, action reference bodies)
 * are carried alongside the main body so the walker can resolve
 * `<reference name="X"/>` without touching DOM.
 */

export interface Position {
  x: number
  y: number
}

export interface Connection {
  refLocalId: number
}

/**
 * One action entry inside an `<actionBlock>`.  Mirrors what
 * `getactions` produces for the DOM walker.
 */
export interface SfcActionEntry {
  qualifier: string
  duration?: string
  indicator?: string
  /** `'reference'` — `value` is an action sub-POU name (looked up in
   *  `SfcBody.actionSubPous`).  `'inline'` — `value` IS the inline
   *  ST text (rare; xml2st xsd-validation rejects it on the
   *  `<action><inline>` shape, so we keep the discriminator but no
   *  fixture exercises this case yet). */
  type: 'reference' | 'inline'
  value: string
}

/**
 * Transition condition — three variants mirroring PLCOpen's
 * `<condition>` content choice.
 */
export type SfcTransitionCondition =
  | { kind: 'inline'; bodyLang: 'ST' | 'IL'; value: string }
  | { kind: 'reference'; name: string }
  | { kind: 'connection'; connections: Connection[] }

export type SfcInstance =
  | {
      kind: 'step'
      localId: number
      position: Position
      name: string
      initial: boolean
      /** Incoming transition wires (`<connectionPointIn>`).  Empty
       *  for the initial step. */
      fromConnections: Connection[]
    }
  | {
      kind: 'transition'
      localId: number
      position: Position
      priority?: number
      /** Wires from the upstream step (or divergence). */
      fromConnections: Connection[]
      condition: SfcTransitionCondition
    }
  | {
      kind: 'jumpStep'
      localId: number
      position: Position
      targetName: string
      fromConnections: Connection[]
    }
  | {
      kind: 'actionBlock'
      localId: number
      position: Position
      /** Single connection back to the step this action block decorates. */
      fromConnections: Connection[]
      actions: SfcActionEntry[]
    }
  | {
      kind: 'selectionDivergence'
      localId: number
      position: Position
      fromConnections: Connection[]
    }
  | {
      kind: 'selectionConvergence'
      localId: number
      position: Position
      fromConnections: Connection[]
    }
  | {
      kind: 'simultaneousDivergence'
      localId: number
      position: Position
      fromConnections: Connection[]
    }
  | {
      kind: 'simultaneousConvergence'
      localId: number
      position: Position
      fromConnections: Connection[]
    }

export interface SfcBody {
  instances: SfcInstance[]
  /** Action sub-POU bodies keyed by `@name`.  Looked up when an
   *  actionBlock entry's `type === 'reference'`. */
  actionSubPous: Map<string, { language: 'ST' | 'IL'; value: string }>
  /** Transition sub-POU bodies keyed by `@name`. */
  transitionSubPous: Map<string, { language: 'ST' | 'IL'; value: string }>
}
