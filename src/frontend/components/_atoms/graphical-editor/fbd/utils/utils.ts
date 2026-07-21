import { Position } from '@xyflow/react'

import type { PLCPou } from '../../../../../../middleware/shared/ports/types'
import type { PLCVariable } from '../../../../../../middleware/shared/ports/types'
import type { FBDFlowType } from '../../../../../store/slices/fbd'
import type { LadderFlowType } from '../../../../../store/slices/ladder'
import { resolveArrayVariableByName } from '../../../../../utils/PLC/array-variable-utils'
import { BlockVariant } from '../../types/block'
import { customNodeTypes } from '..'
import { buildHandle } from '../handle'
import { DEFAULT_BLOCK_CONNECTOR_Y, DEFAULT_BLOCK_CONNECTOR_Y_OFFSET, DEFAULT_BLOCK_WIDTH } from './constants'
import type { BasicNodeData } from './types'

type FBDRung = FBDFlowType['rung']
type FBDRungNode = FBDRung['nodes'][0]
type FBDRungEdge = FBDRung['edges'][0]

type RungLookups = {
  nodeById: Map<string, FBDRungNode>
  edgesBySource: Map<string, FBDRungEdge[]>
  edgesByTarget: Map<string, FBDRungEdge[]>
}

// Per-rung lookup tables, cached on the rung's (immutable) identity.  This
// util runs during every FBD node render; the previous linear scans made a
// render pass O(nodes × (nodes + edges)).  Immer replaces the rung object on
// any change, so a stale entry can never be served.
const rungLookupsCache = new WeakMap<FBDRung, RungLookups>()

const getRungLookups = (rung: FBDRung): RungLookups => {
  let lookups = rungLookupsCache.get(rung)
  if (!lookups) {
    lookups = {
      nodeById: new Map(),
      edgesBySource: new Map(),
      edgesByTarget: new Map(),
    }
    for (const node of rung.nodes) {
      if (!lookups.nodeById.has(node.id)) lookups.nodeById.set(node.id, node)
    }
    for (const edge of rung.edges) {
      const bySource = lookups.edgesBySource.get(edge.source)
      if (bySource) bySource.push(edge)
      else lookups.edgesBySource.set(edge.source, [edge])
      const byTarget = lookups.edgesByTarget.get(edge.target)
      if (byTarget) byTarget.push(edge)
      else lookups.edgesByTarget.set(edge.target, [edge])
    }
    rungLookupsCache.set(rung, lookups)
  }
  return lookups
}

// Variable names are unique per POU (case-insensitive, enforced by the
// variables table), so a first-wins lowercase index matches `find` exactly.
const variablesByNameCache = new WeakMap<PLCVariable[], Map<string, PLCVariable>>()

const getVariablesByName = (variables: PLCVariable[]): Map<string, PLCVariable> => {
  let byName = variablesByNameCache.get(variables)
  if (!byName) {
    byName = new Map()
    for (const variable of variables) {
      const key = variable.name.toLowerCase()
      if (!byName.has(key)) byName.set(key, variable)
    }
    variablesByNameCache.set(variables, byName)
  }
  return byName
}

const EMPTY_EDGES: FBDRungEdge[] = []

const selectNodeVariable = (
  node: FBDRungNode,
  variables: PLCVariable[],
  variableName: string | undefined,
): PLCVariable | undefined => {
  const byName = getVariablesByName(variables)

  const findByNodeVarOrFallback = (): PLCVariable | undefined => {
    const nodeVarName = (node.data as BasicNodeData).variable.name
    if (nodeVarName !== undefined) return byName.get(nodeVarName.toLowerCase())
    if (variableName === undefined) return undefined
    const candidate = byName.get(variableName.toLowerCase())
    return candidate?.name === variableName ? candidate : undefined
  }

  switch (node.type as keyof typeof customNodeTypes) {
    case 'block': {
      const nodeVarName = (node.data as BasicNodeData).variable.name
      return nodeVarName !== undefined ? byName.get(nodeVarName.toLowerCase()) : undefined
    }
    case 'connector':
    case 'continuation':
    case 'comment':
      return undefined
    case 'input-variable':
    case 'output-variable':
    case 'inout-variable':
      // Variable nodes - allow all types including derived (user-defined types)
      return findByNodeVarOrFallback()
    default: {
      // Other node types - only allow base types (not derived/user-defined)
      const candidate = findByNodeVarOrFallback()
      return candidate && candidate.type.definition !== 'derived' ? candidate : undefined
    }
  }
}

// `pouName` is the bound POU for the caller's editor instance (from
// `useBoundPou()` under multi-mount, or the active editor's name for
// legacy single-mount call sites).  Taking it as a string instead of
// the full `EditorModel` avoids leaking the *global* `state.editor`
// into hidden multi-mounted nodes — that was the root cause of the
// "Node or rung not found for ID:" spam we used to see.
export const getFBDPouVariablesRungNodeAndEdges = (
  pouName: string,
  pous: PLCPou[],
  fbdFlows: FBDFlowType[],
  data: { nodeId: string; variableName?: string },
): {
  pou: PLCPou | undefined
  rung: FBDFlowType['rung'] | undefined
  variables: { all: PLCVariable[]; selected: PLCVariable | undefined }
  edges: {
    source: LadderFlowType['rungs'][0]['edges'] | undefined
    target: LadderFlowType['rungs'][0]['edges'] | undefined
  }
  node: LadderFlowType['rungs'][0]['nodes'][0] | undefined
} => {
  const pou = pous.find((pou) => pou.name === pouName)
  const rung = fbdFlows.find((flow) => flow.name === pouName)?.rung
  const lookups = rung ? getRungLookups(rung) : undefined
  const node = lookups?.nodeById.get(data.nodeId)

  const variables: PLCVariable[] = pou?.interface?.variables ?? []
  let variable = node && variables.length > 0 ? selectNodeVariable(node, variables, data.variableName) : undefined

  // Fallback: try to resolve as array element access (e.g. "Sensor[0]")
  if (!variable && node) {
    const nodeType = node.type as keyof typeof customNodeTypes
    if (nodeType !== 'connector' && nodeType !== 'continuation' && nodeType !== 'comment') {
      const varName = (node.data as BasicNodeData).variable.name || data.variableName
      if (varName) {
        const resolved = resolveArrayVariableByName(variables, varName)
        if (
          resolved &&
          (nodeType === 'block' ||
            nodeType === 'input-variable' ||
            nodeType === 'output-variable' ||
            nodeType === 'inout-variable' ||
            resolved.type.definition !== 'derived')
        ) {
          variable = resolved
        }
      }
    }
  }

  const edgesThatNodeIsSource = lookups ? (lookups.edgesBySource.get(data.nodeId) ?? EMPTY_EDGES) : undefined
  const edgesThatNodeIsTarget = lookups ? (lookups.edgesByTarget.get(data.nodeId) ?? EMPTY_EDGES) : undefined

  return {
    pou,
    rung,
    variables: { all: variables, selected: variable },
    edges: { source: edgesThatNodeIsSource, target: edgesThatNodeIsTarget },
    node,
  }
}

export const getBlockSize = (
  variant: BlockVariant,
  handlePosition: {
    x: number
    y: number
  },
) => {
  const inputConnectors = variant.variables
    .filter((variable) => variable.class === 'input' || variable.class === 'inOut')
    .map((variable) => variable.name)
  const outputConnectors = variant.variables
    .filter((variable) => variable.class === 'output' || variable.class === 'inOut')
    .map((variable) => variable.name)

  const blockHeight =
    DEFAULT_BLOCK_CONNECTOR_Y +
    24 +
    Math.max(inputConnectors.length - 1, outputConnectors.length - 1) * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET

  let variableInputWidth = 0
  let variableOutputWidth = 0
  const blockNameWidth = variant.name.length * 12
  inputConnectors.forEach((input) => {
    const inputWidth = input.length * 12
    if (inputWidth > variableInputWidth) variableInputWidth = inputWidth
  })
  outputConnectors.forEach((output) => {
    const outputWidth = output.length * 12
    if (outputWidth > variableOutputWidth) variableOutputWidth = outputWidth
  })

  const blockWidth = Math.min(
    Math.max(variableInputWidth + 12 + variableOutputWidth, blockNameWidth),
    DEFAULT_BLOCK_WIDTH,
  )

  const leftHandles = inputConnectors.map((connector, index) =>
    buildHandle({
      id: `${connector}`,
      position: Position.Left,
      type: 'target',
      glbX: handlePosition.x,
      glbY: handlePosition.y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
      relX: 0,
      relY: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
      style: {
        top: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
        left: 0,
      },
    }),
  )

  const rightHandles = outputConnectors.map((connector, index) =>
    buildHandle({
      id: `${connector}`,
      position: Position.Right,
      type: 'source',
      glbX: handlePosition.x + blockWidth,
      glbY: handlePosition.y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
      relX: blockWidth,
      relY: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
      style: {
        top: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
        right: 0,
      },
    }),
  )

  const handles = [...leftHandles, ...rightHandles]

  return {
    handles,
    leftHandles,
    rightHandles,
    height: blockHeight,
    width: blockWidth,
  }
}

export const getBlockVariantAndExecutionControl = (variantLib: BlockVariant, executionControl: boolean) => {
  const variant = { ...variantLib }

  if (executionControl) {
    const existingEN = variant.variables.find((variable) => variable.name === 'EN')
    const existingENO = variant.variables.find((variable) => variable.name === 'ENO')
    const otherVariables = variant.variables.filter((variable) => variable.name !== 'EN' && variable.name !== 'ENO')

    const EN = existingEN || {
      name: 'EN',
      class: 'input',
      type: { definition: 'base-type', value: 'BOOL' },
    }
    const ENO = existingENO || {
      name: 'ENO',
      class: 'output',
      type: { definition: 'base-type', value: 'BOOL' },
    }

    variant.variables = [EN, ENO, ...otherVariables]
  } else {
    variant.variables = variant.variables.filter((variable) => variable.name !== 'EN' && variable.name !== 'ENO')
  }

  return {
    variant: variant,
    executionControl: executionControl,
  }
}
