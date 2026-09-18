import { FocusEvent, memo, useEffect, useMemo, useRef, useState } from 'react'

import type { PLCVariable } from '../../../../../middleware/shared/ports/types'
import { RefreshIcon } from '../../../../assets/icons/interface/Refresh'
import { useOpenPLCStore } from '../../../../store'
import { checkVariableName } from '../../../../store/slices/project/validation/variables'
import { cn } from '../../../../utils/cn'
import {
  ambiguousInOutFeeds,
  legacyInOutSourcePinIds,
  rewireInOutReads,
} from '../../../../utils/graphical/in-out-pin-rules'
import { isLegalIdentifier } from '../../../../utils/keywords'
import { newUuid } from '../../../../utils/new-uuid'
import { toast } from '../../../_features/[app]/toast/use-toast'
import { useBoundEditorModel, useBoundPou } from '../../../_features/[workspace]/editor/graphical/active-context'
import { HighlightedTextArea } from '../../highlighted-textarea'
import { InputWithRef } from '../../input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../tooltip'
import { BlockOutputDebugBadges } from '../block-output-debug-badges'
import { InOutPinMarker } from '../in-out-pin-marker'
import { BlockVariant } from '../types/block'
import {
  blockInputVariables,
  blockOutputVariables,
  getBlockDocumentation,
  getVariableRestrictionType,
  inOutVariableNames,
} from '../utils'
import { buildBlockNode } from './buildNodes'
import { CustomHandle, type CustomHandleProps } from './handle'
import { BasicNodeData, BlockNodeData, BlockProps } from './utils'
import {
  DEFAULT_BLOCK_CONNECTOR_Y,
  DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
  DEFAULT_BLOCK_HEIGHT,
  DEFAULT_BLOCK_TYPE,
  DEFAULT_BLOCK_WIDTH,
} from './utils/constants'
import { getFBDPouVariablesRungNodeAndEdges } from './utils/utils'

export type { BlockNode, BlockNodeData } from './utils/types'

/**
 * Where a pin's label sits, taken from the pin itself so the label and the dot cannot separate.
 *
 * Handles are persisted inside the node; the connector list a block renders from is derived on
 * every render. The two agree for anything drawn by the current rules, but a diagram saved
 * before VAR_IN_OUT became input-only carries an extra output-side pin, and the index alone
 * would then place labels where no pin exists. Falls back to the index when the node has no
 * geometry for that name at all.
 */
const connectorLabelTop = (handles: CustomHandleProps[] | undefined, connector: string, index: number): number =>
  (handles?.find((handle) => handle.id === connector)?.relPosition?.y ??
    DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET) - 10

export const BlockNodeElement = <T extends object>({
  nodeId,
  data,
  disabled = false,
  height,
  width,
  selected,
  wrongVariable = false,
  scale = 1,
}: {
  nodeId: string
  data: BlockNodeData<T>
  height: number
  width: number
  selected: boolean
  disabled?: boolean
  wrongVariable?: boolean
  scale?: number
}) => {
  const pouName = useBoundPou()
  const editor = useBoundEditorModel()
  const { updateModelVariables, updateModelFBD } = useOpenPLCStore((state) => state.editorActions)
  const { setNodes, setEdges } = useOpenPLCStore((state) => state.fbdFlowActions)
  const { updateVariable, deleteVariable } = useOpenPLCStore((state) => state.projectActions)
  const pushToHistory = useOpenPLCStore((state) => state.snapshotActions.pushToHistory)

  const {
    name: blockName,
    variables: blockVariables,
    type: blockType,
  } = (data.variant as BlockVariant) ?? DEFAULT_BLOCK_TYPE

  const inputConnectors = blockInputVariables(blockVariables).map((variable) => variable.name)
  const outputConnectors = blockOutputVariables(blockVariables).map((variable) => variable.name)
  const inOutConnectors = inOutVariableNames(blockVariables)

  const [blockNameValue, setBlockNameValue] = useState<string>(blockType === 'generic' ? '' : blockName)
  const [validBlockNameValue, setValidBlockNameValue] = useState<string>(blockNameValue)
  const [wrongName, setWrongName] = useState<boolean>(false)

  const inputNameRef = useRef<HTMLInputElement>(null)
  const [inputNameFocus, setInputNameFocus] = useState<boolean>(true)

  /**
   * useEffect to focus the name input when the correct block type is selected
   */
  useEffect(() => {
    if (disabled) return

    if (inputNameRef.current) {
      switch (blockType) {
        case 'generic':
          inputNameRef.current.focus()
          break
        default:
          break
      }
    }
  }, [])

  /**
   * In case the block is disabled, we need to set the block name value to the block name
   */
  useEffect(() => {
    if (disabled) {
      setBlockNameValue(blockName)
      return
    }
  }, [data])

  const handleNameInputOnBlur = () => {
    setInputNameFocus(false)

    if (blockNameValue === blockName) {
      return
    }

    const { project, libraries, fbdFlows } = useOpenPLCStore.getState()
    const { pou, rung, node, variables, edges } = getFBDPouVariablesRungNodeAndEdges(
      pouName,
      project.data.pous,
      fbdFlows,
      {
        nodeId: nodeId ?? '',
      },
    )

    const libraryBlock = libraries.system.flatMap((block) => block.pous).find((pou) => pou.name === blockNameValue)

    if (!libraryBlock) {
      setBlockNameValue(validBlockNameValue)
      toast({ title: 'Invalid name', description: 'The name could not be changed', variant: 'fail' })
      return
    }

    if (!pou || !rung || !node) return

    if (libraryBlock && pou.pouType === 'function' && (libraryBlock as BlockVariant).type !== 'function') {
      setWrongName(true)
      toast({
        title: 'Can not add block',
        description: 'You can not add a function block to a function POU',
        variant: 'fail',
      })
      return
    }

    let variable = variables.selected
    const variableIndex = variable ? variables.all.indexOf(variable) : -1

    if (variable) {
      let res: { ok: boolean; data?: unknown; message?: string; title?: string } = {
        ok: true,
        data: undefined,
        message: '',
        title: '',
      }

      const pouData = project.data.pous.find((p) => p.name === pouName)
      pushToHistory(pouName, {
        variables: pouData?.interface?.variables ?? [],
        body: pouData?.body.value,
      })

      if ((libraryBlock as BlockVariant).type !== 'function-block') {
        const deletionResult = deleteVariable({
          rowId: variableIndex,
          scope: 'local',
          associatedPou: pouName,
        })
        if (!deletionResult.ok) {
          toast({ title: deletionResult.title, description: deletionResult.message, variant: 'fail' })
          return
        }
        if (
          editor.type === 'plc-graphical' &&
          editor.variable.display === 'table' &&
          parseInt(editor.variable.selectedRow) === variableIndex
        ) {
          updateModelVariables({ display: 'table', selectedRow: -1 })
        }
        variable = undefined
      } else {
        res = updateVariable({
          data: {
            type: {
              definition: 'derived',
              value: blockNameValue,
            },
          },
          rowId: variableIndex,
          scope: 'local',
          associatedPou: pouName,
        })
        if (!res.ok) {
          toast({
            title: res.title,
            description: res.message,
            variant: 'fail',
          })
          return
        }
        variable = res.data as PLCVariable | undefined
      }
    }

    let newNodes = [...rung.nodes]
    let newEdges = [...rung.edges]

    /**
     * Update the node with the new block node
     * The new block node have a new ID to not conflict with the old block node and to no occur any error of rendering
     */
    const newBlockNode = buildBlockNode({
      id: `BLOCK_${newUuid()}`,
      position: {
        x: node.position.x,
        y: node.position.y,
      },
      variant: libraryBlock,
      executionControl: (node.data as BlockNodeData<BlockVariant>).executionControl,
    })
    newBlockNode.data = {
      ...newBlockNode.data,
      variable: variable ?? { name: '' },
    }

    newNodes = newNodes.map((n) => (n.id === node.id ? newBlockNode : n))

    edges.source?.forEach((edge) => {
      const newEdge = {
        ...edge,
        id: edge.id.replace(node.id, newBlockNode.id),
        source: newBlockNode.id,
        sourceHandle: newBlockNode.data.outputConnector.id,
      }
      newEdges = newEdges.map((e) => (e.id === edge.id ? newEdge : e))
    })
    edges.target?.forEach((edge) => {
      const newEdge = {
        ...edge,
        id: edge.id.replace(node.id, newBlockNode.id),
        target: newBlockNode.id,
        targetHandle: newBlockNode.data.inputConnector.id,
      }
      newEdges = newEdges.map((e) => (e.id === edge.id ? newEdge : e))
    })

    const pouData2 = project.data.pous.find((p) => p.name === pouName)
    pushToHistory(pouName, {
      variables: pouData2?.interface?.variables ?? [],
      body: pouData2?.body.value,
    })

    setNodes({
      editorName: pouName,
      nodes: newNodes,
    })
    setEdges({
      editorName: pouName,
      edges: newEdges,
    })

    setWrongName(false)
  }

  const onMouseEnter = () => {
    updateModelFBD({
      hoveringElement: { elementId: nodeId, hovering: true },
    })
  }

  const onMouseLeave = () => {
    updateModelFBD({
      hoveringElement: { elementId: null, hovering: false },
    })
  }

  const handleFocusInput = (e: FocusEvent<HTMLInputElement, Element>) => {
    e.target.select()
    setValidBlockNameValue(blockNameValue)
    setInputNameFocus(true)
  }

  return (
    <div
      className={cn(
        'relative flex flex-col rounded-md border border-neutral-850 bg-white text-neutral-1000 dark:bg-neutral-900 dark:text-neutral-50',
        {
          'hover:border-transparent hover:ring-2 hover:ring-brand': !disabled,
          'border-transparent ring-1 ring-red-500': wrongVariable || wrongName,
          'border-transparent ring-2 ring-brand': selected,
        },
      )}
      style={{
        width: width,
        height: height,
        transform: `scale(${scale})`,
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <InputWithRef
        value={blockNameValue}
        onChange={(e) => setBlockNameValue(e.target.value.toUpperCase())}
        maxLength={20}
        placeholder='???'
        className='absolute top-2 w-full bg-transparent text-center text-xs outline-none'
        disabled={disabled}
        onFocus={handleFocusInput}
        onBlur={() => inputNameFocus && handleNameInputOnBlur()}
        onKeyDown={(e) => e.key === 'Enter' && inputNameRef.current?.blur()}
        ref={inputNameRef}
      />
      {/*
       * Labels are placed from the pin they name, looked up BY ID, falling back to the index when
       * the node carries no geometry for it. The derived list and the persisted pins can
       * disagree: a diagram saved before VAR_IN_OUT became input-only still holds the in-out's
       * output-side pin, so the index alone would put a label where no pin is drawn.
       */}
      {inputConnectors.map((connector, index) => (
        <div
          key={index}
          className='absolute text-xs'
          style={{ top: connectorLabelTop(data.inputHandles, connector, index), left: 6 }}
        >
          {connector}
          {inOutConnectors.has(connector) && <InOutPinMarker />}
        </div>
      ))}
      {outputConnectors.map((connector, index) => (
        <div
          key={index}
          className='absolute text-xs'
          style={{ top: connectorLabelTop(data.outputHandles, connector, index), right: 6 }}
        >
          {connector}
        </div>
      ))}
    </div>
  )
}

/**
 * Where the execution-order badge's centre sits, measured in from the block's
 * bottom-right corner.
 *
 * The badge is meant to be quartered by the two borders -- a quarter inside the
 * block, three quarters out. Centring it on the mathematical corner does that
 * on paper, but `rounded-md` (6px) means the drawn border has already curved
 * away by the time it reaches that point, so the circle reads as hanging low
 * and outside. The straight run of each border ends one radius short of the
 * corner, so the midpoint between the two -- half the radius -- is where the
 * borders visually cut the circle in half.
 */
const BLOCK_CORNER_RADIUS = 6
const EXECUTION_ORDER_BADGE_INSET = BLOCK_CORNER_RADIUS / 2

const Block = <T extends object>(block: BlockProps<T>) => {
  const { data, dragging, height, width, selected, id } = block
  const pouName = useBoundPou()
  const pous = useOpenPLCStore((state) => state.project.data.pous)
  const createVariable = useOpenPLCStore((state) => state.projectActions.createVariable)
  const pushToHistory = useOpenPLCStore((state) => state.snapshotActions.pushToHistory)
  const { updateNode, setNodes, setEdges } = useOpenPLCStore((state) => state.fbdFlowActions)
  const addLog = useOpenPLCStore((state) => state.consoleActions.addLog)
  // Pou-scoped subscription: immer's structural sharing keeps this flow's
  // identity stable when other POUs' flows (or unrelated slices) change.
  const flow = useOpenPLCStore((state) => state.fbdFlows.find((f) => f.name === pouName))
  const { type: blockType, name: blockVariantName } = (data.variant as BlockVariant) ?? DEFAULT_BLOCK_TYPE
  const documentation = getBlockDocumentation(data.variant as BlockVariant)

  const [blockVariableValue, setBlockVariableValue] = useState<string>('')
  const [wrongVariable, setWrongVariable] = useState<boolean>(false)
  const [hoveringBlock, setHoveringBlock] = useState(false)

  const { rung, node, variables } = getFBDPouVariablesRungNodeAndEdges(pouName, pous, flow ? [flow] : [], {
    nodeId: id ?? '',
  })

  // Output-side pins this block still carries for an in-out parameter — empty for every diagram
  // saved since in-outs became input-only.
  const staleInOutSourcePins = useMemo(() => legacyInOutSourcePinIds(data), [data])

  // Outputs connected to variable nodes already show their own badge — skip those
  const connectedOutputNames = useMemo(() => {
    const names = new Set<string>()
    if (!rung) return names
    const outgoingEdges = rung.edges.filter((e) => e.source === id)
    for (const edge of outgoingEdges) {
      const targetNode = rung.nodes.find((n) => n.id === edge.target)
      if (targetNode && typeof targetNode.type === 'string' && targetNode.type.includes('variable')) {
        if (edge.sourceHandle) names.add(edge.sourceHandle)
      }
    }
    return names
  }, [rung, id])

  const inputVariableRef = useRef<
    HTMLTextAreaElement & {
      blur: ({ submit }: { submit?: boolean }) => void
      isFocused: boolean
    }
  >(null)

  /**
   * useEffect to focus the variable input when the correct block type is selected
   */
  const hasCreatedRef = useRef(false)

  useEffect(() => {
    if (data.variable && data.variable.name !== '' && blockType === 'function-block') {
      setBlockVariableValue(data.variable.name)
      hasCreatedRef.current = true
      return
    }

    if (inputVariableRef.current && selected && !hasCreatedRef.current) {
      switch (blockType) {
        case 'function-block': {
          if (!data.variable || data.variable.name === '') {
            const { name, number } = checkVariableName(variables.all, (data.variant as BlockVariant).name.toUpperCase())
            handleSubmitBlockVariableOnTextareaBlur(`${name}${number}`, true)
            hasCreatedRef.current = true
            return
          }
          inputVariableRef.current.focus()
          return
        }
        default:
          break
      }
    }
  }, [data])

  /**
   * Update wrongVariable state when the table of variables is updated
   */
  useEffect(() => {
    if (blockType !== 'function-block') {
      setWrongVariable(false)
      return
    }

    if (!node || !rung) {
      console.error('Node or rung not found for ID:', id)
      return
    }

    const variable = variables.selected
    if (!variable) {
      setWrongVariable(true)
      return
    }

    if ((node.data as BasicNodeData).variable.id === variable.id) {
      if ((node.data as BasicNodeData).variable.name !== variable.name) {
        updateNode({
          editorName: pouName,
          nodeId: node.id,
          node: {
            ...node,
            data: {
              ...node.data,
              variable,
            },
          },
        })
        setWrongVariable(false)
        return
      }
    }

    setWrongVariable(false)
  }, [pous])

  /**
   * Handle with the variable input onBlur event
   */
  const handleSubmitBlockVariableOnTextareaBlur = (variableName?: string, createIfNotFound?: boolean) => {
    const variableNameToSubmit = variableName || blockVariableValue

    if (variableNameToSubmit === '') {
      setWrongVariable(true)
      return
    }

    const { fbdFlows } = useOpenPLCStore.getState()
    const { rung, node, variables } = getFBDPouVariablesRungNodeAndEdges(pouName, pous, fbdFlows, {
      nodeId: id,
    })

    if (!rung || !node) {
      toast({
        title: 'Error',
        description: 'Could not find the related rung or node',
        variant: 'fail',
      })
      return
    }

    const blockType = (node.data as BlockNodeData<BlockVariant>).variant.name

    const findMatchingVariable = () =>
      variables.all.find(
        (variable) =>
          variable.name.toLowerCase() === variableNameToSubmit.toLowerCase() &&
          variable.type.definition === 'derived' &&
          variable.type.value.toLowerCase() === blockType.toLowerCase(),
      )

    const updateNodeVariable = (variable: Partial<PLCVariable> | { name: string }) => {
      updateNode({
        editorName: pouName,
        nodeId: node.id,
        node: {
          ...node,
          data: { ...node.data, variable },
        },
      })
    }

    let variableToLink = variables.selected

    const matchingVariable = findMatchingVariable()

    if (variableToLink) {
      if (variableToLink.name.toLowerCase() === variableNameToSubmit.toLowerCase()) return

      if (matchingVariable && matchingVariable.id !== variableToLink.id) {
        variableToLink = matchingVariable
      } else {
        updateNodeVariable({ name: variableNameToSubmit })
        setWrongVariable(true)
        return
      }
    } else {
      if (matchingVariable) {
        variableToLink = matchingVariable
      } else if (createIfNotFound) {
        // An entry that can't be a new variable NAME — a member/array reference,
        // a typed literal (`T#500ms`), a reserved word — is bound to the block
        // verbatim as a constant/reference instead of erroring.
        if (!isLegalIdentifier(variableNameToSubmit)[0]) {
          updateNodeVariable({ name: variableNameToSubmit })
          return
        }
        const pouData = pous.find((p) => p.name === pouName)
        pushToHistory(pouName, {
          variables: pouData?.interface?.variables ?? [],
          body: pouData?.body.value,
        })

        const creationResult = createVariable({
          data: {
            id: newUuid(),
            name: variableNameToSubmit,
            type: { definition: 'derived', value: blockType },
            class: 'local',
            location: '',
            documentation: '',
            debug: false,
          },
          scope: 'local',
          associatedPou: pouName,
        })

        if (!creationResult.ok) {
          toast({
            title: creationResult.title,
            description: creationResult.message,
            variant: 'fail',
          })
          return
        }
        variableToLink = creationResult.data as PLCVariable
      } else {
        updateNodeVariable({ name: variableNameToSubmit })
        setWrongVariable(true)
        return
      }
    }

    updateNodeVariable(variableToLink)
    setBlockVariableValue(variableToLink.name)
    setWrongVariable(false)
  }

  const handleUpdateDivergence = () => {
    const { fbdFlows, libraries } = useOpenPLCStore.getState()
    const { rung, node, pou } = getFBDPouVariablesRungNodeAndEdges(pouName, pous, fbdFlows, {
      nodeId: id,
    })
    if (!pou || !rung || !node) return

    const variant = (node.data as BlockNodeData<BlockVariant>)?.variant
    if (!variant) return

    const libMatch = libraries.user.find((lib) => lib.name === variant.name && lib.type === variant.type)
    if (!libMatch) return

    const libPou = pous.find((pou) => pou.name === libMatch.name)
    if (!libPou) return

    const blockVariant = node.data.variant as BlockVariant
    const newNodeVariables = (libPou.interface?.variables ?? []).map((variable) => {
      let newType
      switch (variable.type.definition) {
        case 'array':
          newType = {
            ...variable.type,
            value: variable.type.value.toUpperCase(),
            data: variable.type.data,
          }
          break
        case 'base-type':
          newType = {
            value: variable.type.value.toUpperCase(),
            definition: 'base-type',
          }
          break
        case 'user-data-type':
          newType = {
            value: variable.type.value.toUpperCase(),
            definition: 'user-data-type',
          }
          break
        case 'derived':
          newType = {
            value: variable.type.value.toUpperCase(),
            definition: 'derived',
          }
          break
        default:
          newType = variable.type
      }
      return {
        ...variable,
        type: newType,
      }
    })

    if (libPou.pouType === 'function') {
      const variable = getVariableRestrictionType(libPou.interface?.returnType ?? '')
      const hasOut = newNodeVariables.some((v) => v.name === 'OUT')
      if (!hasOut)
        newNodeVariables.push({
          id: 'OUT',
          name: 'OUT',
          class: 'output',
          type: {
            definition: variable.definition ?? 'derived',
            value: (libPou.interface?.returnType ?? '').toUpperCase(),
          },
          location: '',
          documentation: '',
          debug: false,
        })
    }

    const updatedNewNode = buildBlockNode({
      id: `BLOCK_${newUuid()}`,
      position: {
        x: node.position.x,
        y: node.position.y,
      },
      variant: { name: libPou.name, type: blockVariant.type, variables: newNodeVariables },
      executionControl: (node.data as BlockNodeData<BlockVariant>).executionControl,
    })
    updatedNewNode.data = {
      ...updatedNewNode.data,
      variable: variables.selected ?? { name: '' },
    }

    if (!pou || !rung || !node) return

    const newNode = { ...updatedNewNode }

    const originalNodeInputs = blockInputVariables((node.data.variant as BlockVariant).variables)
    const originalNodeSources = blockOutputVariables((node.data.variant as BlockVariant).variables)

    const updatedInputVariables = blockInputVariables(newNode.data.variant.variables)
    const updatedOutputVariables = blockOutputVariables(newNode.data.variant.variables)

    let newNodes = [...rung.nodes]
    newNodes = newNodes.map((nodeItem) => (nodeItem.id === node.id ? newNode : nodeItem))

    // An in-out pin fed by more than one wire has no single source to re-point its readers at,
    // and the old two-sided pin accepted any number. Refuse rather than pick one by array
    // position: nothing has been written to the store yet, so the diagram is left exactly as it
    // is for the user to resolve the extra connections first.
    const ambiguous = ambiguousInOutFeeds(node, rung.edges)
    if (ambiguous.length > 0) {
      toast({
        title: 'Cannot update this block yet',
        description:
          `${ambiguous.join(', ')} ${ambiguous.length === 1 ? 'is' : 'are'} connected to more than one ` +
          `variable. A VAR_IN_OUT parameter takes exactly one — remove the extra connection(s), then update.`,
        variant: 'fail',
      })
      return
    }

    // A wire that READ one of this block's in-out pins has to be re-pointed at whatever feeds
    // the pin before the remap below: the block wrote through the reference, so reading the pin
    // and reading its source are the same value. Do it first — a rewired edge no longer has
    // `source === node.id`, so it falls through the remap as an unchanged edge instead of being
    // dropped for having no matching output handle.
    const reads = rewireInOutReads(node, rung.edges)

    // Update edges to match new node and variable positions
    // Only reconnect edges that were previously connected to the node and have a matching handle in the updated node
    const newEdges = reads.edges
      .map((edge) => {
        const isSource = edge.source === node.id
        const isTarget = edge.target === node.id

        // Only update edges that were previously connected to the node
        if (isSource) {
          // Find the handle name in the original node's output variables
          const outputIndex = originalNodeSources.findIndex((v) => v.name === edge.sourceHandle)
          // Only connect if the handle exists in both original and updated node
          if (outputIndex === -1) return null

          const updatedHandle = updatedOutputVariables.find((v) => v.name === originalNodeSources[outputIndex].name)
          if (updatedHandle)
            return {
              ...edge,
              source: newNode.id,
              sourceHandle: updatedHandle.name,
            }

          const origId = originalNodeSources[outputIndex].id
          if (origId) {
            const updatedHandleId = updatedOutputVariables.find((v) => v.id === origId)
            if (updatedHandleId)
              return {
                ...edge,
                source: newNode.id,
                sourceHandle: updatedHandleId.name,
              }
          }

          return null
        }

        if (isTarget) {
          // Find the handle name in the original node's input variables
          const inputIndex = originalNodeInputs.findIndex((v) => v.name === edge.targetHandle)
          // Only connect if the handle exists in both original and updated node
          if (inputIndex === -1) return null

          const updatedHandle = updatedInputVariables.find((v) => v.name === originalNodeInputs[inputIndex].name)
          if (updatedHandle)
            return {
              ...edge,
              target: newNode.id,
              targetHandle: updatedHandle.name,
            }

          const origIdIn = originalNodeInputs[inputIndex].id
          if (origIdIn) {
            const updatedHandleId = updatedInputVariables.find((v) => v.id === origIdIn)
            if (updatedHandleId)
              return {
                ...edge,
                target: newNode.id,
                targetHandle: updatedHandleId.name,
              }
          }

          return null
        }

        // Unchanged edge
        return edge
      })
      .filter((edge) => edge !== null)

    setNodes({
      editorName: pouName,
      nodes: newNodes,
    })
    setEdges({
      editorName: pouName,
      edges: newEdges,
    })

    // Say what the conversion did to the wires. An in-out read that could be re-pointed keeps
    // working; one whose pin had nothing feeding it cannot be salvaged and is gone, and the user
    // has to be told rather than left to notice a missing connection later.
    if (reads.rewired > 0 || reads.dropped > 0) {
      addLog({
        level: reads.dropped > 0 ? 'warning' : 'info',
        message:
          `${blockVariantName}: VAR_IN_OUT pins no longer have an output side. ` +
          `${reads.rewired} connection(s) re-pointed at the pin's source` +
          (reads.dropped > 0 ? `, ${reads.dropped} removed (nothing was feeding the pin).` : '.'),
      })
    }
  }

  // 0 means "not ordered", so only a positive, finite order renders a badge.
  // `Number.isFinite` still earns its place: a project file can carry anything,
  // and a non-finite value must not reach the badge as "Infinity".
  const executionOrderBadge =
    Number.isFinite(data.executionOrder) && data.executionOrder > 0 ? Math.trunc(data.executionOrder) : null

  return (
    <div
      className={cn('relative', {
        'opacity-40': id.startsWith('copycat'),
      })}
      onMouseEnter={() => setHoveringBlock(true)}
      onMouseLeave={() => setHoveringBlock(false)}
    >
      {/* Execution-order badge. Only when the block carries an order (> 0 --
          0 means "unordered", see the Block Properties dialog), so an ordinary
          diagram stays uncluttered and a numbered one shows its sequence
          without opening a dialog per block (DOPE-606).

          Anchored to the block's own width/height rather than the wrapper's
          edges: the wrapper is a few pixels taller than the drawn block, so
          `bottom-0` sat below the border. Centring on the corner leaves the
          badge a quarter inside the block and three quarters outside, and it
          holds for a two-digit number because the translate is relative to the
          badge's own size. */}
      {executionOrderBadge !== null && (
        <div
          className='pointer-events-none absolute z-10 flex h-5 min-w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-brand px-1 font-caption text-[10px] font-medium leading-none text-white shadow-sm ring-2 ring-white dark:ring-neutral-950'
          style={{
            left: (width ?? DEFAULT_BLOCK_WIDTH) - EXECUTION_ORDER_BADGE_INSET,
            top: (height ?? DEFAULT_BLOCK_HEIGHT) - EXECUTION_ORDER_BADGE_INSET,
          }}
          aria-label={`Execution order ${executionOrderBadge}`}
          title={`Execution order: ${executionOrderBadge}`}
        >
          {executionOrderBadge}
        </div>
      )}

      {data.hasDivergence && hoveringBlock && (
        <div
          className='pointer absolute right-[-12px] top-[-12px] z-10 flex h-6 w-6 items-center justify-center rounded-full bg-slate-600 shadow-sm'
          onClick={handleUpdateDivergence}
        >
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <RefreshIcon />
              </TooltipTrigger>
              <TooltipContent side='top' className='text-xs'>
                Update node
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <BlockNodeElement
              nodeId={id}
              data={data}
              height={height ?? DEFAULT_BLOCK_HEIGHT}
              width={width ?? DEFAULT_BLOCK_WIDTH}
              selected={selected ?? false}
              wrongVariable={wrongVariable}
            />
          </TooltipTrigger>
          {!dragging && blockType !== 'generic' && documentation && (
            <TooltipContent side='right' className='text-xs'>
              <span className='whitespace-pre-line'>{documentation}</span>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
      <div
        className='absolute -top-[10px]'
        style={{
          width: width ?? DEFAULT_BLOCK_WIDTH,
        }}
      >
        {(data.variant as BlockVariant).type !== 'function' && (data.variant as BlockVariant).type !== 'generic' && (
          <HighlightedTextArea
            textAreaValue={blockVariableValue}
            setTextAreaValue={setBlockVariableValue}
            handleSubmit={() => handleSubmitBlockVariableOnTextareaBlur(blockVariableValue, false)}
            onFocus={(e) => e.target.select()}
            onBlur={() => {}}
            inputHeight={{
              height: 13,
              scrollLimiter: 14,
            }}
            ref={inputVariableRef}
            textAreaClassName='text-center text-xs leading-3'
            highlightClassName='text-center text-xs leading-3'
          />
        )}
      </div>
      {data.handles.map((handle, index) => (
        <CustomHandle
          key={index}
          {...handle}
          // A diagram saved before VAR_IN_OUT became input-only still carries the pin's output
          // side, and this list is what actually renders. Keep drawing it so the existing wire
          // stays visible — dropping it here would make a connection that is still in the file
          // vanish from the canvas — but refuse NEW wires from a pin that no longer exists.
          // The block's update badge is what removes it.
          isConnectable={
            handle.type === 'source' && handle.id !== undefined && staleInOutSourcePins.has(handle.id)
              ? false
              : handle.isConnectable
          }
        />
      ))}
      <BlockOutputDebugBadges
        blockType={(data.variant as BlockVariant).type}
        blockName={(data.variant as BlockVariant).name}
        blockVariableName={data.variable?.name ?? ''}
        numericId={data.numericId}
        outputVariables={(data.variant as BlockVariant).variables}
        connectorStartY={DEFAULT_BLOCK_CONNECTOR_Y}
        connectorOffsetY={DEFAULT_BLOCK_CONNECTOR_Y_OFFSET}
        blockWidth={width ?? DEFAULT_BLOCK_WIDTH}
        connectedOutputNames={connectedOutputNames}
      />
    </div>
  )
}

// Cast keeps the generic call signature `memo` would otherwise widen away.
const exportBlock = memo(Block) as typeof Block

export { exportBlock as Block }
