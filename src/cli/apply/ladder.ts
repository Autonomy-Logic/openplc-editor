/**
 * Spec ladder body -> a laid-out flow in the store.
 *
 * The geometry is not computed here. `buildLadderRung` emits every element at
 * the origin and `addLadderFlow` runs the editor's own solver over it, so a
 * CLI-authored rung is placed by exactly the code that places a hand-drawn one.
 */

import { openPLCStoreBase } from '@root/frontend/store'
import { needsPositionRecovery } from '@root/frontend/store/slices/ladder/slice'
import {
  buildLadderRung,
  type RungLogic,
  type RungOutput,
  type RungVariableResolver,
} from '@root/frontend/store/slices/ladder/utils/build-rung'
import { buildBlockVariant } from '@root/frontend/utils/PLC/block-variant'
import type { Edge, Node } from '@xyflow/react'

import { unresolvedHandles } from './handles'
import type { SpecLadderBody, SpecLadderOutput } from './schema'

export function applyLadderBody(pouName: string, body: SpecLadderBody): string[] {
  const errors: string[] = []
  const state = openPLCStoreBase.getState()

  // Mirrors the editor's own lookup (`ladder/utils/utils.ts`): the POU's own
  // variables, matched case-insensitively, and a contact or coil will not take a
  // derived type.
  const declared = state.project.data.pous.find((pou) => pou.name === pouName)?.interface?.variables ?? []
  const resolveVariable = (name: string, kind: 'contact' | 'coil' | 'block') =>
    declared.find(
      (variable) =>
        variable.name.toLowerCase() === name.toLowerCase() &&
        (kind === 'block' || variable.type.definition !== 'derived'),
    )

  const rungs = body.rungs.map((spec, index) => {
    const outputs: RungOutput[] = []
    for (const output of spec.outputs) {
      const built = toOutput(pouName, output, errors)
      if (built) outputs.push(built)
    }
    return buildLadderRung({
      rungId: `rung-${index}`,
      comment: spec.comment,
      logic: spec.logic as RungLogic | undefined,
      outputs,
      resolveVariable,
    })
  })

  if (errors.length > 0) return errors

  state.ladderFlowActions.removeLadderFlow(pouName)
  state.ladderFlowActions.addLadderFlow({ name: pouName, updated: true, rungs } as never)

  // Naming the pins comes AFTER the flow is added, because `addLadderFlow` is
  // what creates one variable element per block pin. Creating them here too
  // would leave the rung with two elements on every pin.
  nameBlockPins(pouName, body, errors, resolveVariable)

  // The solver runs inside a try with guards that silently return the rung
  // unchanged. The LD walker sorts sinks by y-position, so an unrecovered rung
  // does not look broken — it transpiles to the wrong statement order.
  const flow = openPLCStoreBase.getState().ladderFlows.find((entry) => entry.name === pouName)
  for (const rung of flow?.rungs ?? []) {
    if (needsPositionRecovery(rung)) {
      errors.push(`POU "${pouName}" rung "${rung.id}": the editor could not lay this rung out.`)
    }
    // Checked on the stored rung, not the built one: `addLadderFlow` adds the
    // block pin elements and their edges, so this is the only shape the editor
    // will actually render.
    for (const problem of unresolvedHandles(rung.nodes as Node[], rung.edges as Edge[])) {
      errors.push(`POU "${pouName}" rung "${rung.id}": ${problem}.`)
    }
  }
  return errors
}

/**
 * Put the requested variable on each block pin the spec named.
 *
 * `addLadderFlow` gives every data pin its own variable element, unnamed. The
 * elements carry `data.block.handleId`, which is the pin's name, so the one to
 * name is found by that rather than by position.
 */
function nameBlockPins(
  pouName: string,
  body: SpecLadderBody,
  errors: string[],
  resolveVariable: RungVariableResolver,
): void {
  const flow = openPLCStoreBase.getState().ladderFlows.find((entry) => entry.name === pouName)
  const updates: Array<{ node: Node; nodeId: string; rungId: string; editorName: string }> = []
  /**
   * What the GUI records on the BLOCK when a pin's variable is named
   * (`ladder/variable.tsx`'s `updateRelatedNode`). Naming the element is only
   * half the job: the block's `connectedVariables` is what tells the editor a
   * pin already shows its own value, and `BlockOutputDebugBadges` skips an
   * output found there. Leaving it empty drew the value twice on every named
   * output pin — once from the element, once from the block.
   */
  const connections = new Map<string, { rungId: string; block: Node; entries: unknown[] }>()

  for (const [index, spec] of body.rungs.entries()) {
    const rung = flow?.rungs[index]
    if (!rung) continue

    const nodes = rung.nodes as Node[]
    // Paired by position: `buildLadderRung` appends one block per block output,
    // in order, so the Nth block node in the rung is the Nth block the spec
    // asked for.
    const placed = nodes.filter((node) => node.type === 'block')
    const asked = spec.outputs.filter((output) => 'block' in output)

    for (const [slot, output] of asked.entries()) {
      if (!('block' in output)) continue
      const block = placed[slot]
      if (!block) continue

      const pins = { ...(output.block.inputs ?? {}), ...(output.block.outputs ?? {}) }
      for (const [pin, source] of Object.entries(pins)) {
        // Matched on the OWNING BLOCK as well as the pin name. Keying on the pin
        // alone let three blocks that each declare `POSITION` collide, and the
        // last one in the document silently won on all of them.
        const element = nodes.find((node) => {
          if (node.type !== 'variable') return false
          const data = node.data as { block?: { id?: string; handleId?: string } }
          return data.block?.id === block.id && data.block.handleId === pin
        })

        if (!element) {
          errors.push(
            `POU "${pouName}" rung "${rung.id}": pin "${pin}" on "${output.block.call}" has no variable element ` +
              `to name. A pin carrying rung power is wired to the next element rather than to a variable.`,
          )
          continue
        }

        updates.push({
          editorName: pouName,
          rungId: rung.id,
          nodeId: element.id,
          node: { ...element, data: { ...element.data, variable: { name: source } } } as Node,
        })

        const elementData = element.data as { variant?: string; block?: { handleId?: string } }
        const variant = (block.data as { variant?: { variables?: Array<{ id?: string; name: string }> } }).variant
        const entry = connections.get(block.id) ?? { rungId: rung.id, block, entries: [] }
        entry.entries.push({
          handleId: pin,
          handleTableId: variant?.variables?.find((declared) => declared.name === pin)?.id,
          type: elementData.variant,
          // The resolved declaration when the name is one, and a bare name
          // otherwise — a pin can carry a literal (`TRUE`, `100`), and the GUI
          // stores those the same way.
          variable: resolveVariable(source, 'block') ?? { name: source },
        })
        connections.set(block.id, entry)
      }
    }
  }

  // One update per block, not one per pin: each carries the whole list, so
  // separate updates would each overwrite the last.
  for (const { rungId, block, entries } of connections.values()) {
    updates.push({
      editorName: pouName,
      rungId,
      nodeId: block.id,
      node: { ...block, data: { ...block.data, connectedVariables: entries } } as Node,
    })
  }

  if (updates.length > 0) openPLCStoreBase.getState().ladderFlowActions.updateNodes(updates)
}

function toOutput(pouName: string, output: SpecLadderOutput, errors: string[]): RungOutput | null {
  if ('coil' in output) return { coil: output.coil }

  const state = openPLCStoreBase.getState()
  const built = buildBlockVariant({
    blockRef: output.block.call,
    systemLibraries: state.libraries.system,
    userLibraries: state.libraries.user,
    pous: state.project.data.pous,
  })
  if (!built.ok) {
    errors.push(`POU "${pouName}": block "${output.block.call}" — ${built.reason.replace('-', ' ')}.`)
    return null
  }
  // Cloned for the same reason as in `apply/fbd.ts`: the library's `variables`
  // array is frozen, and a placed block should carry its own copy.
  const variant = structuredClone(built.variant)

  // A pin name that is not on the block would otherwise be dropped in silence —
  // the rung would look wired and the call would go out without it.
  // An in-out pin — SoftMotion's `AXIS` — sits on the left with the inputs and is
  // named through `inputs`. It is not optional: the compiler refuses a call that
  // leaves one unassigned.
  const accepts: Record<'input' | 'output', readonly string[]> = { input: ['input', 'inOut'], output: ['output'] }
  for (const [side, pins] of [
    ['input', output.block.inputs],
    ['output', output.block.outputs],
  ] as const) {
    for (const pin of Object.keys(pins ?? {})) {
      if (variant.variables.some((entry) => entry.name === pin && accepts[side].includes(entry.class ?? ''))) continue
      const legal = variant.variables
        .filter((entry) => accepts[side].includes(entry.class ?? ''))
        .map((entry) => entry.name)
        .join(', ')
      errors.push(`POU "${pouName}": block "${variant.name}" has no ${side} pin "${pin}". Its ${side}s are: ${legal}.`)
      return null
    }
  }

  return {
    block: {
      variant,
      instance: output.block.instance,
      inputs: output.block.inputs,
      outputs: output.block.outputs,
      executionControl: output.block.executionControl,
    },
  }
}
