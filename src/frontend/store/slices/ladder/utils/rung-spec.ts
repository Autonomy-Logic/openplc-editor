import { Edge, getNodesBounds, Node } from '@xyflow/react'

import type { PLCVariable } from '../../../../../middleware/shared/ports/types'
import {
  defaultCustomNodesStyles,
  nodesBuilder,
} from '../../../../components/_atoms/graphical-editor/ladder/node-builders'
import type {
  BasicNodeData,
  BlockNodeData,
  BlockVariant,
  LadderBlockConnectedVariables,
} from '../../../../components/_atoms/graphical-editor/ladder/utils/types'
import { connectNodes } from '../../../../components/_molecules/graphical-editor/ladder/rung/ladder-utils/edges'
import { updateDiagramElementsPosition } from '../../../../components/_molecules/graphical-editor/ladder/rung/ladder-utils/elements/diagram'
import { getLiteralType } from '../../../../utils/keywords'
import { newGraphicalEditorNodeID } from '../../../../utils/new-graphical-editor-node-id'
import { validateVariableType } from '../../../../utils/PLC/validate-variable-type'
import { RungLadderState } from '../types'

/** Re-exported so `adapters` code (the AI tool executor) can reference the block-resolution
 *  type without importing `components` directly — `adapters -> components` is forbidden by
 *  `validate:arch`, but this file already has the `KNOWN_EXCEPTIONS` entry for it. */
export type { BlockVariant }

/** The UI's default rung viewport — see `[workspace]/editor/graphical/ladder/index.tsx`. */
const DEFAULT_BOUNDS: [number, number] = [300, 100]

export type LadderContactVariant = 'default' | 'negated' | 'risingEdge' | 'fallingEdge'
export type LadderCoilVariant = LadderContactVariant | 'set' | 'reset'

export type ContactElementSpec = { kind: 'contact'; variable: string; variant?: LadderContactVariant }
export type CoilElementSpec = { kind: 'coil'; variable: string; variant?: LadderCoilVariant }
/** `variable` is a variable name or, on an input pin, an IEC literal such as `T#5s`. */
export type BlockPinBinding = { pin: string; variable: string }
export type BlockElementSpec = {
  kind: 'block'
  blockType: string
  instanceName?: string
  pins?: BlockPinBinding[]
}
/** Phase 1 vocabulary — `parallel` elements are Phase 2 (see AI_LADDER_GENERATION_PLAN.md). */
export type LadderElementSpec = ContactElementSpec | CoilElementSpec | BlockElementSpec

export type RungSpec = {
  comment?: string
  elements: LadderElementSpec[]
  /** Set by rungToSpec when the rung has a parallel branch it can't represent yet (Phase 2). */
  truncated?: boolean
}

// Stricter than `getLiteralType`: the pin text is emitted verbatim into ST, so an unescaped quote would end the string early.
const IEC_STRING_LITERAL = /^'(?:[^'$\r\n]|\$(?:[$'LNPRTlnprt]|[0-9A-Fa-f]{2}))*'$/

const findVariable = (variables: PLCVariable[], name: string): PLCVariable | undefined =>
  variables.find((v) => v.name.toLowerCase() === name.toLowerCase())

/** Mirrors `updateReactFlowPanelExtent` (rung/body.tsx) so a builder-authored rung gets the
 *  same viewport a mounted editor would have computed — an LD POU never opened in the editor
 *  must not fall back to the (possibly too-small) `defaultBounds` seed. */
function computeReactFlowViewport(nodes: Node[], defaultBounds: [number, number]): [number, number] {
  const zeroPositionNode: Node = { id: '-1', position: { x: 0, y: 0 }, data: {}, width: 150, height: 40 }
  const bounds = getNodesBounds([zeroPositionNode, ...nodes])
  return [Math.max(bounds.width, defaultBounds[0]), Math.max(bounds.height, defaultBounds[1]) + 20]
}

function buildRailNodes(rungId: string, defaultBounds: [number, number]) {
  const { powerRail } = defaultCustomNodesStyles
  const leftRail = nodesBuilder.powerRail({
    id: `left-rail-${rungId}`,
    posX: 0,
    posY: defaultBounds[1] / 2 - powerRail.height / 2,
    connector: 'right',
    handleX: powerRail.width,
    handleY: defaultBounds[1] / 2,
  })
  const rightRail = nodesBuilder.powerRail({
    id: `right-rail-${rungId}`,
    posX: defaultBounds[0],
    posY: defaultBounds[1] / 2 - powerRail.height / 2,
    connector: 'left',
    handleX: defaultBounds[0] - powerRail.width,
    handleY: defaultBounds[1] / 2,
  })
  return { leftRail, rightRail }
}

/** The first input handle and first output handle are a block's rail connectors and can
 *  never be bound to a variable directly (see block.tsx / variable-block/index.ts) — e.g.
 *  for TON that's IN/Q, bindable pins are PT/ET. Errors are pushed to `errors` rather than
 *  thrown so the caller can report every problem in the spec at once. */
function resolvePinBindings(
  blockNode: ReturnType<typeof nodesBuilder.block>,
  blockVariant: BlockVariant,
  pins: BlockPinBinding[] | undefined,
  variables: PLCVariable[],
  blockTypeName: string,
  elementNumber: number,
  errors: string[],
): LadderBlockConnectedVariables {
  if (!pins || pins.length === 0) return []

  const railInputId = blockNode.data.inputHandles[0]?.id
  const railOutputId = blockNode.data.outputHandles[0]?.id
  const bindableInputIds = new Set(blockNode.data.inputHandles.slice(1).map((h) => h.id))

  const connectedVariables: LadderBlockConnectedVariables = []
  for (const { pin, variable } of pins) {
    const variantVar = blockVariant.variables.find((v) => v.name === pin)
    if (!variantVar) {
      errors.push(`Element ${elementNumber}: pin "${pin}" does not exist on block type "${blockTypeName}"`)
      continue
    }
    if (variantVar.class === 'inOut') {
      errors.push(`Element ${elementNumber}: pin "${pin}" is inOut — not supported yet`)
      continue
    }
    if (pin === railInputId || pin === railOutputId) {
      errors.push(`Element ${elementNumber}: pin "${pin}" is the block's rail connector and cannot be bound directly`)
      continue
    }
    const type = bindableInputIds.has(pin) ? 'input' : 'output'
    const resolved = findVariable(variables, variable)
    if (resolved) {
      connectedVariables.push({ handleId: pin, type, variable: resolved })
      continue
    }
    const literalTypes = getLiteralType(variable)
    if (!literalTypes) {
      errors.push(`Element ${elementNumber}: variable "${variable}" not found for pin "${pin}"`)
      continue
    }
    if (variable.startsWith("'") && !IEC_STRING_LITERAL.test(variable)) {
      errors.push(
        `Element ${elementNumber}: "${variable}" is not a valid string literal for pin "${pin}" — escape a quote inside it as $'`,
      )
      continue
    }
    if (type === 'output') {
      errors.push(
        `Element ${elementNumber}: pin "${pin}" is an output and cannot be bound to the literal "${variable}"`,
      )
      continue
    }
    const pinType = variantVar.type.value.toUpperCase()
    if (!literalTypes.some((literalType) => validateVariableType(literalType, pinType).isValid)) {
      errors.push(`Element ${elementNumber}: literal "${variable}" is not compatible with pin "${pin}" (${pinType})`)
      continue
    }
    // Same shape the UI stores for a literal typed into a pin (variable.tsx).
    connectedVariables.push({ handleId: pin, type, variable: { name: variable } })
  }
  return connectedVariables
}

/**
 * Build a full rung from a logical element spec — the AI tool-call path's equivalent of a
 * user dragging elements onto the canvas. Mirrors `duplicateLadderRung` (the existing
 * worked example of rebuilding a rung programmatically): seed the rails, build each element
 * with `nodesBuilder`, wire it in with `connectNodes`, then run the real layout solver once.
 *
 * Returns `errors` rather than a partial rung when anything can't be resolved — the caller
 * (the AI tool executor) is expected to validate inputs up front for richer messages; this
 * is the last line of defense so a bad spec can never produce a half-built diagram.
 */
export function buildRungFromSpec(args: {
  rungId: string
  spec: RungSpec
  /** POU interface + globals — used to resolve every `variable`/`instanceName`/pin binding by name. */
  variables: PLCVariable[]
  resolveBlock: (blockType: string) => BlockVariant | undefined
  defaultBounds?: [number, number]
}): { ok: true; rung: RungLadderState } | { ok: false; errors: string[] } {
  const { rungId, spec, variables, resolveBlock, defaultBounds = DEFAULT_BOUNDS } = args
  const errors: string[] = []

  const { leftRail, rightRail } = buildRailNodes(rungId, defaultBounds)

  const nodes: Node[] = [{ ...leftRail, selected: false }]
  let edges: Edge[] = [
    {
      id: `e_${leftRail.id}_${rightRail.id}`,
      source: leftRail.id,
      target: rightRail.id,
      sourceHandle: leftRail.data.handles[0].id,
      targetHandle: rightRail.data.handles[0].id,
      type: 'smoothstep',
    },
  ]
  let previousNodeId: string = leftRail.id

  const wireNext = (node: Node) => {
    nodes.push(node)
    const rungSoFar: RungLadderState = {
      id: rungId,
      comment: spec.comment ?? '',
      defaultBounds,
      reactFlowViewport: defaultBounds,
      selectedNodes: [],
      nodes: [...nodes, rightRail],
      edges,
    }
    edges = connectNodes(rungSoFar, previousNodeId, node.id, 'serial')
    previousNodeId = node.id
  }

  spec.elements.forEach((element, index) => {
    const elementNumber = index + 1

    if (element.kind === 'contact' || element.kind === 'coil') {
      const variable = findVariable(variables, element.variable)
      if (!variable) {
        errors.push(`Element ${elementNumber}: variable "${element.variable}" not found`)
        return
      }
      const id = newGraphicalEditorNodeID(element.kind.toUpperCase())
      const built =
        element.kind === 'contact'
          ? nodesBuilder.contact({
              id,
              posX: 0,
              posY: 0,
              handleX: 0,
              handleY: 0,
              variant: element.variant ?? 'default',
            })
          : nodesBuilder.coil({ id, posX: 0, posY: 0, handleX: 0, handleY: 0, variant: element.variant ?? 'default' })
      wireNext({ ...built, selected: false, data: { ...built.data, variable } })
      return
    }

    const blockVariant = resolveBlock(element.blockType)
    if (!blockVariant) {
      errors.push(`Element ${elementNumber}: block type "${element.blockType}" not found`)
      return
    }

    let instanceVariable: PLCVariable | undefined
    if (blockVariant.type === 'function-block') {
      if (!element.instanceName) {
        errors.push(
          `Element ${elementNumber}: block type "${element.blockType}" is a function block and requires "instanceName"`,
        )
        return
      }
      instanceVariable = findVariable(variables, element.instanceName)
      if (!instanceVariable) {
        errors.push(`Element ${elementNumber}: instance variable "${element.instanceName}" not found`)
        return
      }
    }

    const built = nodesBuilder.block({
      id: newGraphicalEditorNodeID('BLOCK'),
      posX: 0,
      posY: 0,
      handleX: 0,
      handleY: 0,
      variant: blockVariant,
      executionControl: false,
    })
    const connectedVariables = resolvePinBindings(
      built,
      blockVariant,
      element.pins,
      variables,
      element.blockType,
      elementNumber,
      errors,
    )
    wireNext({
      ...built,
      selected: false,
      data: { ...built.data, variable: instanceVariable ?? built.data.variable, connectedVariables },
    })
  })

  nodes.push({ ...rightRail, selected: false })

  if (errors.length > 0) return { ok: false, errors }

  const preLayoutRung: RungLadderState = {
    id: rungId,
    comment: spec.comment ?? '',
    defaultBounds,
    reactFlowViewport: defaultBounds,
    selectedNodes: [],
    nodes,
    edges,
  }
  const laidOut = updateDiagramElementsPosition(preLayoutRung, defaultBounds)

  const rung: RungLadderState = {
    id: rungId,
    comment: spec.comment ?? '',
    defaultBounds,
    reactFlowViewport: computeReactFlowViewport(laidOut.nodes, defaultBounds),
    selectedNodes: [],
    nodes: laidOut.nodes.map((node) => ({ ...node, selected: false })),
    edges: laidOut.edges,
  }

  return { ok: true, rung }
}

const SPEC_NODE_TYPES = new Set(['contact', 'coil', 'block', 'parallel'])

/**
 * Walk a rung's main serial spine (left rail to right rail, following each node's
 * `outputConnector`) and produce the logical spec `buildRungFromSpec` accepts — the
 * read half of read-modify-write. Deliberately NOT `describeRung` (graphical-context.ts),
 * which groups all contacts/coils/blocks together and loses interleaving.
 *
 * A parallel branch stops the walk (`truncated: true`) rather than misreporting a partial
 * chain as the whole rung — full parallel read-back is Phase 2. Handle branches and any
 * other element left off the spine also mark the spec `truncated`.
 */
export function rungToSpec(rung: RungLadderState): RungSpec {
  const elements: LadderElementSpec[] = []

  const leftRail = rung.nodes.find((node) => node.id.startsWith('left-rail'))
  if (!leftRail) return { comment: rung.comment, elements }

  let currentId: string | undefined = leftRail.id
  let currentOutputHandle: string | undefined = (leftRail.data as BasicNodeData).outputConnector?.id
  let truncated = false
  const visited = new Set<string>()

  while (currentId) {
    const edge = rung.edges.find((e) => e.source === currentId && e.sourceHandle === currentOutputHandle)
    if (!edge) break

    const node = rung.nodes.find((n) => n.id === edge.target)
    if (!node || node.id.startsWith('right-rail')) break

    if (node.type === 'parallel') {
      truncated = true
      break
    }

    if (node.type === 'contact') {
      const data = node.data as BasicNodeData & { variant?: LadderContactVariant }
      elements.push({ kind: 'contact', variable: data.variable.name, variant: data.variant ?? 'default' })
    } else if (node.type === 'coil') {
      const data = node.data as BasicNodeData & { variant?: LadderCoilVariant }
      elements.push({ kind: 'coil', variable: data.variable.name, variant: data.variant ?? 'default' })
    } else if (node.type === 'block') {
      const data = node.data as BlockNodeData<BlockVariant>
      const pins: BlockPinBinding[] = (data.connectedVariables ?? []).flatMap((cv) =>
        cv.variable?.name ? [{ pin: cv.handleId, variable: cv.variable.name }] : [],
      )
      elements.push({
        kind: 'block',
        blockType: data.variant.name,
        ...(data.variable?.name ? { instanceName: data.variable.name } : {}),
        ...(pins.length > 0 ? { pins } : {}),
      })
    }

    visited.add(node.id)
    currentId = node.id
    currentOutputHandle = (node.data as BasicNodeData).outputConnector?.id
  }

  const offSpine = rung.nodes.some(
    (node) => node.data.branchContext !== undefined || (SPEC_NODE_TYPES.has(node.type ?? '') && !visited.has(node.id)),
  )
  if (offSpine) truncated = true

  return { comment: rung.comment, elements, ...(truncated ? { truncated: true as const } : {}) }
}
