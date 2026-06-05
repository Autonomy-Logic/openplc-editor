/**
 * Graph-walk primitives used by `ComputeConnectionTypes` and downstream
 * phases. Each function mirrors a Python method on `PouProgramGenerator`
 * (`PLCGenerator.py:820-878`), preserving names and semantics 1:1.
 *
 * The Python pipeline tracks `RelatedConnections` as mutable state on the
 * generator instance. The TS port externalizes this state into a
 * `Phase2State` value passed explicitly into every function that reads or
 * mutates it — easier to test, no module-level globals.
 */

import {
  getconnectionPointOut,
  getconnectionPointOutAll,
  getconnections,
  getcontentInstance,
  getformalParameter,
  getoutputVariables,
  getposition,
  getpositions,
  getrefLocalId,
  getrelPositionXY,
  getvariable,
  InstanceTag,
} from '../plcopen/accessors'
import { type Element } from '../xmlclass/xsdschema'

/**
 * Mutable state carried through Phase 2 type inference.
 *
 * `connectionTypes` mirrors `PouProgramGenerator.ConnectionTypes`: maps a
 * connection-point element to its inferred IEC type (e.g. `"BOOL"`, `"INT"`,
 * `"TIME"`). Insertion order is preserved by `Map` to match Python `dict`,
 * though Phase 2 logic only relies on membership, not order.
 *
 * `relatedConnections` mirrors `PouProgramGenerator.RelatedConnections`:
 * a list of equivalence classes (groups of connection points that share an
 * unknown type). Each `ExtractRelatedConnections` call may pop a group out;
 * `ComputeConnectionTypes` may push new groups in.
 */
export interface Phase2State {
  connectionTypes: Map<Element, string>
  relatedConnections: Element[][]
}

export function newPhase2State(): Phase2State {
  return { connectionTypes: new Map(), relatedConnections: [] }
}

/**
 * Given a `<connection refLocalId=X>` link inside some `<connectionPointIn>`,
 * return the connection point on the *source side* that feeds it — i.e. the
 * output connector of the instance with `localId == X`.
 *
 * For multi-output blocks and multi-output power rails the link must
 * disambiguate which output port it connects to. Disambiguation order:
 *   1. `link.@formalParameter` (block only)
 *   2. last vertex of the link's polyline vs. each output port's absolute
 *      position
 *
 * Mirrors Python's `PouProgramGenerator.GetLinkedConnector`
 * (`PLCGenerator.py:826`).
 */
export function GetLinkedConnector(link: Element, body: Element): Element | null {
  const parameter = getformalParameter(link)
  const refId = getrefLocalId(link)
  if (refId === null) return null
  const instance = getcontentInstance(body, refId)
  if (!instance) return null

  switch (instance.localName) {
    case InstanceTag.InVariable:
    case InstanceTag.InOutVariable:
    case InstanceTag.Continuation:
    case InstanceTag.Contact:
    case InstanceTag.Coil:
      return getconnectionPointOut(instance)

    case InstanceTag.Block:
      return resolveBlockOutput(link, instance, parameter)

    case InstanceTag.LeftPowerRail:
      return resolvePowerRailOutput(link, instance)

    default:
      return null
  }
}

function resolveBlockOutput(link: Element, block: Element, parameter: string | null): Element | null {
  const outputs = getoutputVariables(block)
  if (!outputs) return null
  const outputVars = getvariable(outputs)
  if (outputVars.length === 1) {
    return getconnectionPointOut(outputVars[0])
  }
  if (parameter !== null) {
    for (const v of outputVars) {
      if (getformalParameter(v) === parameter) {
        return getconnectionPointOut(v)
      }
    }
    return null
  }
  return resolveByEndpointPosition(
    link,
    block,
    outputVars.map((v) => getconnectionPointOut(v)),
  )
}

function resolvePowerRailOutput(link: Element, rail: Element): Element | null {
  const outs = getconnectionPointOutAll(rail)
  if (outs.length === 1) return outs[0]
  return resolveByEndpointPosition(link, rail, outs)
}

/**
 * When a multi-output instance can't disambiguate by formal parameter, the
 * link's terminal vertex must equal the instance's position plus the output
 * port's relative position. Mirrors Python's identical logic in both
 * `GetLinkedConnector` branches.
 *
 * `candidates` may contain `null` entries (when an output variable is missing
 * a `<connectionPointOut>` child); those are skipped silently to match
 * Python's truthy-check pattern.
 */
function resolveByEndpointPosition(link: Element, owner: Element, candidates: (Element | null)[]): Element | null {
  const positions = getpositions(link)
  if (positions.length === 0) return null
  const endpoint = positions[positions.length - 1]
  const base = getposition(owner)
  if (!base) return null

  for (const cp of candidates) {
    if (!cp) continue
    const rel = getrelPositionXY(cp)
    if (!rel) continue
    if (endpoint.x === base.x + rel[0] && endpoint.y === base.y + rel[1]) {
      return cp
    }
  }
  return null
}

/**
 * For a connection point with exactly **one** link, return the connection
 * point on the other end. Returns `null` for fan-in / fan-out points and for
 * dangling ones — matches the Python wrapper exactly.
 */
export function GetConnectedConnector(connector: Element, body: Element): Element | null {
  const links = getconnections(connector)
  if (links.length === 1) {
    return GetLinkedConnector(links[0], body)
  }
  return null
}

/**
 * Pop the equivalence class containing `connection` out of `state.relatedConnections`,
 * or return a singleton group when `connection` is not yet tracked.
 *
 * Python uses `list.pop(i)` to remove the group during iteration; the TS
 * port does the same via `splice`. The function mutates `state`.
 */
export function ExtractRelatedConnections(state: Phase2State, connection: Element): Element[] {
  for (let i = 0; i < state.relatedConnections.length; i++) {
    if (state.relatedConnections[i].includes(connection)) {
      const [group] = state.relatedConnections.splice(i, 1)
      return group
    }
  }
  return [connection]
}
