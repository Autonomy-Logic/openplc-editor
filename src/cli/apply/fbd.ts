/**
 * Spec FBD body -> a placed, wired flow in the store.
 *
 * Node construction and layout live in `store/slices/fbd/utils/build-graph`,
 * because the node builders are component modules the CLI may not import. What
 * is left here is the part the CLI owns: resolving a block reference to its
 * signature, and reporting failures in the spec's own vocabulary.
 */

import { openPLCStoreBase } from '@root/frontend/store'
import { buildFbdGraph, type FbdGraphNode } from '@root/frontend/store/slices/fbd/utils/build-graph'
import { buildBlockVariant } from '@root/frontend/utils/PLC/block-variant'

import { unresolvedHandles } from './handles'
import type { SpecFbdBody } from './schema'

/** Pins the editor adds itself; they are not in a library's declared list. */
const IMPLICIT_PINS = new Set(['EN', 'ENO'])

/**
 * Check every `label.PIN` against the block it names, growing an extensible
 * block to fit.
 *
 * ADD, MUL, AND and friends declare `IN1`/`IN2` and accept any number — the GUI
 * grows them with a `+`. A spec that wires `IN3` is asking for exactly that, so
 * the pin is appended, typed like the last declared input. MUX is the odd one:
 * it numbers from zero (`K`, `IN0`, `IN1`), so its next pin is `IN2`. A pin that
 * is NOT a legal extension is an error, because the alternative is silence.
 */
function resolvePins(pouName: string, nodes: FbdGraphNode[], body: SpecFbdBody): string[] {
  const errors: string[] = []
  const byLabel = new Map(nodes.map((node) => [node.label, node]))

  for (const connection of body.connections) {
    for (const [ref, side] of [
      [connection.from, 'source'],
      [connection.to, 'target'],
    ] as const) {
      const dot = ref.indexOf('.')
      if (dot < 0) continue
      const label = ref.slice(0, dot)
      const pin = ref.slice(dot + 1)
      const node = byLabel.get(label)
      if (!node || node.kind !== 'block') continue

      const variant = node.variant as
        | { name?: string; extensible?: boolean; variables?: Array<{ name: string; class?: string; type?: unknown }> }
        | undefined
      const pins = variant?.variables
      if (!pins) continue
      if (IMPLICIT_PINS.has(pin) || pins.some((entry) => entry.name === pin)) continue

      const grown = growExtensiblePin(variant, pin)
      if (grown) continue

      const legal = pins.map((entry) => entry.name).join(', ')
      errors.push(
        `POU "${pouName}": block "${variant?.name ?? label}" has no ${side === 'source' ? 'output' : 'input'} pin ` +
          `"${pin}". Its pins are: ${legal}.`,
      )
    }
  }
  return errors
}

/**
 * Append `IN<n>` to an extensible block, typed like its last declared input.
 * Returns false when the block is not extensible or the name is not the next
 * numbered input.
 */
function growExtensiblePin(
  variant: { extensible?: boolean; variables?: Array<{ name: string; class?: string; type?: unknown }> } | undefined,
  pin: string,
): boolean {
  if (!variant?.extensible || !variant.variables) return false
  const match = /^IN(\d+)$/.exec(pin)
  if (!match) return false

  const inputs = variant.variables.filter((entry) => entry.class === 'input' && /^IN\d+$/.test(entry.name))
  const last = inputs[inputs.length - 1]
  if (!last) return false

  // Count from the HIGHEST existing index, not from how many there are: `MUX`
  // numbers its inputs from zero (`K`, `IN0`, `IN1`), so a count-based next
  // index skips `IN2` — accepting it as valid while adding no pin, and leaving
  // a hole in the argument list if `IN3` is wired later.
  const highest = Math.max(...inputs.map((entry) => Number(/^IN(\d+)$/.exec(entry.name)?.[1] ?? 0)))
  const wanted = Number(match[1])
  if (wanted <= highest) return true

  // Grow one at a time so a jump from IN2 to IN9 does not leave holes the
  // transpiler would emit as missing arguments.
  for (let index = highest + 1; index <= wanted; index += 1) {
    variant.variables.push({ ...last, name: `IN${index}` })
  }
  return true
}

export function applyFbdBody(pouName: string, body: SpecFbdBody): string[] {
  const errors: string[] = []
  const state = openPLCStoreBase.getState()

  const nodes: FbdGraphNode[] = []
  for (const spec of body.nodes) {
    let variant: unknown
    if (spec.kind === 'block') {
      if (!spec.call) {
        errors.push(`POU "${pouName}": node "${spec.label}" is a block and needs "call".`)
        continue
      }
      const built = buildBlockVariant({
        blockRef: spec.call,
        systemLibraries: state.libraries.system,
        userLibraries: state.libraries.user,
        pous: state.project.data.pous,
      })
      if (!built.ok) {
        errors.push(`POU "${pouName}": block "${spec.call}" — ${built.reason.replace(/-/g, ' ')}.`)
        continue
      }
      // Cloned: the system branch of `buildBlockVariant` hands back the
      // library's own `variables` array, which the store has frozen. Growing an
      // extensible block writes to it, and a placed block should not alias the
      // library's array in any case.
      variant = structuredClone(built.variant)
    }

    nodes.push({
      label: spec.label,
      kind: spec.kind,
      variant,
      variable: spec.kind === 'block' ? spec.instance : spec.variable,
      text: spec.text,
      executionControl: spec.executionControl,
      executionOrder: spec.executionOrder,
    })
  }

  // A label is how a connection names a node, so two nodes sharing one makes
  // every reference to it ambiguous — the graph builder keeps the last and the
  // earlier node silently loses its wires.
  const seenLabels = new Set<string>()
  for (const node of nodes) {
    if (seenLabels.has(node.label)) {
      errors.push(`POU "${pouName}": two nodes are both labelled "${node.label}"; a label names one node.`)
    }
    seenLabels.add(node.label)
  }

  if (errors.length > 0) return errors

  // Every pin a connection names must exist, or be one an extensible block can
  // grow. A wrong pin name is otherwise dropped in silence: the diagram looks
  // wired and the transpiler emits the call without it.
  errors.push(...resolvePins(pouName, nodes, body))
  if (errors.length > 0) return errors

  const graph = buildFbdGraph(nodes, body.connections)
  if (graph.errors.length > 0) return graph.errors.map((error) => `POU "${pouName}": ${error}.`)

  // `addFBDFlow` adds nothing, so the built graph is what renders. A pin name
  // that survived `resolvePins` but is not a declared handle stops here.
  const dangling = unresolvedHandles(graph.nodes, graph.edges)
  if (dangling.length > 0) return dangling.map((problem) => `POU "${pouName}": ${problem}.`)

  for (const broken of graph.brokenCycles) {
    // FBD is a left-to-right data flow: a diagram cannot feed a block from
    // something downstream of it. Refused rather than placed, because the
    // layout can only draw such a diagram by ignoring the connection — which
    // would render as a wire that does not carry anything.
    errors.push(
      `POU "${pouName}": "${broken.from}" feeds "${broken.to}", which feeds it back. FBD has no feedback ` +
        'within one diagram — carry the value in a variable, which holds it to the next scan.',
    )
  }
  if (errors.length > 0) return errors

  state.fbdFlowActions.addFBDFlow({
    name: pouName,
    rung: { comment: '', nodes: graph.nodes, edges: graph.edges, selectedNodes: [] },
  } as never)
  // `addFBDFlow` forces `updated: false` — it exists for loading a saved flow —
  // so without this the body would never be written back.
  state.fbdFlowActions.setFlowUpdated({ editorName: pouName, updated: true } as never)
  return []
}
