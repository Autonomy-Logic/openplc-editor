import { Node } from '@xyflow/react'
import { ComponentPropsWithRef, forwardRef, useEffect, useMemo, useState } from 'react'

import { PLCVariable } from '../../../../../../middleware/shared/ports/types'
import {
  getScopeCompletions,
  newVariableTypeForExpected,
  type ScopeCompletion,
  scopeCompletionToVariable,
} from '../../../../../services/graphical-scope'
import { useOpenPLCStore } from '../../../../../store'
import type { CreateGraphicalVariableModalData } from '../../../../../store/slices/modal/types'
import { cn } from '../../../../../utils/cn'
import { getLiteralType, isLegalIdentifier } from '../../../../../utils/keywords'
import type { BoundBlockPin } from '../../../../../utils/PLC/validate-variable-type'
import { isGenericTypeName } from '../../../../../utils/PLC/validate-variable-type'
import { toast } from '../../../../_features/[app]/toast/use-toast'
import { useBoundPou } from '../../../../_features/[workspace]/editor/graphical/active-context'
import { buildGenericNode } from '../../../../_molecules/graphical-editor/fbd/fbd-utils/nodes'
import { GraphicalEditorAutocomplete } from '../../autocomplete'
import { BlockVariant } from '../../types/block'
import { CustomFbdNodeTypes } from '..'
import { BasicNodeData } from '../utils'
import { getFBDPouVariablesRungNodeAndEdges } from '../utils/utils'

/** Minimal shape of an FBD rung this module needs — nodes plus their wiring. */
type FBDRungGraph = {
  nodes: Node[]
  edges: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }[]
}

const VARIABLE_BOX_TYPES = ['input-variable', 'output-variable', 'inout-variable']

/**
 * The pins of the same block instance that already carry a variable. A generic
 * pin (`ANY`, `ANY_NUM`, …) has no type of its own, so a variable created on it
 * takes the concrete type the block already settled on elsewhere (#479).
 *
 * Walks the graph the same way `expectedType` does — from this box to the block
 * it is wired to — and then across that block's remaining edges.
 */
const boundPinsOfConnectedBlock = (rung: FBDRungGraph, boxId: string, isInputBox: boolean): BoundBlockPin[] => {
  const linkToBlock = rung.edges.find((edge) => (isInputBox ? edge.source === boxId : edge.target === boxId))
  const blockId = isInputBox ? linkToBlock?.target : linkToBlock?.source
  if (!blockId) return []

  const pinDefinitions = (rung.nodes.find((node) => node.id === blockId)?.data.variant as BlockVariant | undefined)
    ?.variables
  if (!pinDefinitions) return []

  const pins: BoundBlockPin[] = []
  for (const edge of rung.edges) {
    const intoBlock = edge.target === blockId
    if (!intoBlock && edge.source !== blockId) continue

    const otherId = intoBlock ? edge.source : edge.target
    if (otherId === boxId) continue

    // Only variable boxes carry a concrete type; a block on the other end
    // exposes its own pins, not a variable's type.
    const otherNode = rung.nodes.find((node) => node.id === otherId)
    if (!otherNode || !VARIABLE_BOX_TYPES.includes(otherNode.type ?? '')) continue

    const pinType = pinDefinitions.find((pin) => pin.name === (intoBlock ? edge.targetHandle : edge.sourceHandle))?.type
      .value
    const variable = (otherNode.data as BasicNodeData | undefined)?.variable
    const variableType = variable && 'type' in variable ? variable.type.value : undefined
    if (pinType && variableType) pins.push({ pinType, variableType })
  }
  return pins
}

type FBDBlockAutoCompleteProps = ComponentPropsWithRef<'div'> & {
  block: unknown
  isOpen?: boolean
  setIsOpen?: (isOpen: boolean) => void
  keyPressed?: string
  valueToSearch: string
}

const FBDBlockAutoComplete = forwardRef<HTMLDivElement, FBDBlockAutoCompleteProps>(
  ({ block: unknownBlock, isOpen, setIsOpen, keyPressed, valueToSearch }: FBDBlockAutoCompleteProps, ref) => {
    const pouName = useBoundPou()
    const pous = useOpenPLCStore((state) => state.project.data.pous)
    const createVariable = useOpenPLCStore((state) => state.projectActions.createVariable)
    const fbdFlows = useOpenPLCStore((state) => state.fbdFlows)
    const { updateNode, addNode } = useOpenPLCStore((state) => state.fbdFlowActions)
    const openModal = useOpenPLCStore((state) => state.modalActions.openModal)

    const block = unknownBlock as Node<BasicNodeData> & { positionAbsoluteX?: number; positionAbsoluteY?: number }
    const { edges, rung } = useMemo(() => {
      return getFBDPouVariablesRungNodeAndEdges(pouName, pous, fbdFlows, {
        nodeId: block.id,
      })
    }, [pous, fbdFlows, pouName, block.id])

    const isVariableBox = block.type === 'input-variable' || block.type === 'output-variable'
    const isConnectionBox = block.type === 'connector' || block.type === 'continuation'

    /**
     * The IEC type the connected block pin expects. Drives both the LSP
     * type filter and the type of any newly-created variable. `undefined`
     * when the box isn't wired to a pin (no filter — suggest everything).
     */
    const expectedType = useMemo<string | undefined>(() => {
      if (!isVariableBox) return undefined
      const connections = block.type === 'input-variable' ? edges.source : edges.target
      for (const edge of connections ?? []) {
        const connectedNode = rung?.nodes.find(
          (node) => node.id === (block.type === 'input-variable' ? edge.target : edge.source),
        )
        const variableType = (connectedNode?.data.variant as BlockVariant | undefined)?.variables?.find(
          (variable) => variable.name === (block.type === 'input-variable' ? edge.targetHandle : edge.sourceHandle),
        )?.type.value
        if (variableType) return variableType
      }
      return undefined
    }, [isVariableBox, block.type, edges, rung])

    // Variable boxes: LSP-backed candidates (variables + instance/struct
    // members in scope) filtered by the connected pin's type.
    const [variableCandidates, setVariableCandidates] = useState<ScopeCompletion[]>([])
    useEffect(() => {
      if (!isVariableBox) {
        setVariableCandidates([])
        return
      }
      let cancelled = false
      void getScopeCompletions(pouName, valueToSearch, expectedType).then((items) => {
        if (!cancelled) setVariableCandidates(items)
      })
      return () => {
        cancelled = true
      }
    }, [isVariableBox, pouName, valueToSearch, expectedType, pous])

    // Connector/continuation boxes suggest the matching pair's labels — a
    // graph-topology concern, unrelated to variable scope, kept as-is.
    const connectionCandidates = useMemo<PLCVariable[]>(() => {
      if (!isConnectionBox) return []
      return (
        rung?.nodes
          .filter((node) => (block.type === 'connector' ? node.type === 'continuation' : node.type === 'connector'))
          .map((node) => node.data.variable as PLCVariable)
          .filter((variable) => variable.name !== '') ?? []
      )
    }, [isConnectionBox, rung, block.type])

    const displayVariables = isVariableBox
      ? variableCandidates.map((c) => ({ id: c.insertText, name: c.insertText }))
      : isConnectionBox
        ? connectionCandidates.map((v) => ({ id: v.id ?? '', name: v.name }))
        : []

    const submitVariableToBlock = (variable: PLCVariable) => {
      const { rung: freshRung, node: variableNode } = getFBDPouVariablesRungNodeAndEdges(pouName, pous, fbdFlows, {
        nodeId: block.id,
      })
      if (!freshRung || !variableNode) return

      updateNode({
        editorName: pouName,
        nodeId: variableNode.id,
        node: {
          ...variableNode,
          data: {
            ...variableNode.data,
            variable: variable,
          },
        },
      })
    }

    const submitAddVariable = ({ variableName }: { variableName: string }) => {
      if (!variableName.trim()) {
        toast({
          title: 'Invalid variable name',
          description: 'Variable name cannot be empty',
          variant: 'fail',
        })
        return
      }

      // If the entry can't be a new variable NAME — a member/array reference
      // (`some_struct.field`, `arr[3]`), a typed literal (`T#500ms`), a reserved
      // word, etc. — don't try to create a variable. Bind it to the block
      // verbatim as a constant/reference; strucpp validates the expression. New
      // local-variable creation is only for plain, legal identifiers.
      if (!isLegalIdentifier(variableName)[0]) {
        submitVariableToBlock({ name: variableName } as PLCVariable)
        return
      }

      const { rung: freshRung, node } = getFBDPouVariablesRungNodeAndEdges(pouName, pous, fbdFlows, {
        nodeId: block.id,
      })
      if (!freshRung || !node) return

      const variableType = newVariableTypeForExpected(
        expectedType,
        isVariableBox ? boundPinsOfConnectedBlock(freshRung, block.id, block.type === 'input-variable') : [],
      )

      // A generic pin accepts several types, so the inferred one is a proposal,
      // not a fact — let the user confirm it instead of creating silently
      // (issue #479). Concrete pins leave no room for choice and keep creating
      // straight away.
      if (expectedType && isGenericTypeName(expectedType)) {
        openModal('create-graphical-variable', {
          pinType: expectedType,
          name: variableName,
          suggestedType: variableType,
          onConfirm: (choice) => createAndBindVariable(choice),
          onCancel: clearBoundVariable,
        } satisfies CreateGraphicalVariableModalData)
        return
      }

      createAndBindVariable({ name: variableName, class: 'local', type: variableType })
    }

    /**
     * Empty this box. Opening the type dialog blurs the box, which binds the
     * typed text as a raw reference — abandoning the dialog must not leave that
     * dangling name behind.
     */
    const clearBoundVariable = () => {
      const { project, fbdFlows: freshFlows } = useOpenPLCStore.getState()
      const { node } = getFBDPouVariablesRungNodeAndEdges(pouName, project.data.pous, freshFlows, {
        nodeId: block.id,
      })
      if (!node) return

      updateNode({
        editorName: pouName,
        nodeId: node.id,
        node: { ...node, data: { ...node.data, variable: { id: '', name: '' } } },
      })
    }

    /**
     * Create the local variable and bind it to this box. Reads the rung/node
     * fresh from the store because the type dialog may have resolved long after
     * the dropdown that started this closed.
     */
    const createAndBindVariable = ({
      name,
      class: variableClass,
      type,
    }: {
      name: string
      class: PLCVariable['class']
      type: { definition: PLCVariable['type']['definition']; value: string }
    }) => {
      const { project, fbdFlows: freshFlows } = useOpenPLCStore.getState()
      const { node } = getFBDPouVariablesRungNodeAndEdges(pouName, project.data.pous, freshFlows, {
        nodeId: block.id,
      })
      if (!node) return

      const res = createVariable({
        data: {
          id: crypto.randomUUID(),
          name,
          type: {
            definition: type.definition,
            value: type.value,
          },
          class: variableClass,
          location: '',
          documentation: '',
          debug: false,
        },
        scope: 'local',
        associatedPou: pouName,
      })
      if (!res.ok) {
        toast({ title: res.title, description: res.message, variant: 'fail' })
        return
      }

      const variable = res.data as PLCVariable | undefined

      updateNode({
        editorName: pouName,
        nodeId: node.id,
        node: {
          ...node,
          data: {
            ...node.data,
            variable: variable ?? { id: '', name: '' },
          },
        },
      })
    }

    const submitCreateANewBlock = (blockType: CustomFbdNodeTypes) => {
      const newBlock = buildGenericNode({
        id: crypto.randomUUID(),
        position:
          block.positionAbsoluteX && block.positionAbsoluteY
            ? { x: block.positionAbsoluteX, y: block.positionAbsoluteY + (block.height ?? 0) + 16 }
            : { x: 0, y: 0 },
        nodeType: blockType,
        connectionLabel: valueToSearch,
      })
      if (!newBlock) return

      addNode({
        editorName: pouName,
        node: newBlock,
      })
    }

    const submit = ({ variable }: { variable: { id: string; name: string } }) => {
      if (variable.id === 'add') {
        // A literal value (e.g. 2.0, TRUE, 'hello') binds directly to the block.
        if (getLiteralType(valueToSearch)) {
          submitVariableToBlock({ name: valueToSearch } as PLCVariable)
          return
        }
        submitAddVariable({ variableName: valueToSearch })
        return
      }

      if (variable.id === 'newBlock') {
        submitCreateANewBlock(variable.name as CustomFbdNodeTypes)
        return
      }

      if (isVariableBox) {
        // Dropdown items are LSP candidates keyed by their full insert text
        // (e.g. `TON0.Q`); bind the node to the chosen one, carrying its type.
        const candidate = variableCandidates.find((c) => c.insertText.toLowerCase() === variable.name.toLowerCase())
        if (candidate) {
          submitVariableToBlock(scopeCompletionToVariable(candidate))
          return
        }
        submitAddVariable({ variableName: valueToSearch })
        return
      }

      // Connector/continuation: bind to the matching node label.
      const selected = connectionCandidates.find(
        (variableItem) => variableItem.name.toLowerCase() === variable.name.toLowerCase(),
      )
      if (!selected) {
        submitAddVariable({ variableName: valueToSearch })
        return
      }
      submitVariableToBlock(selected)
    }

    return (
      <GraphicalEditorAutocomplete
        ref={ref}
        className={cn('h-[200px] w-[200px] overflow-auto', isOpen ? 'block' : 'hidden')}
        isOpen={isOpen}
        setIsOpen={setIsOpen}
        canCreateNewVariable={!isConnectionBox}
        newBlock={{
          canCreate: isConnectionBox,
          options: {
            label: `Add ${block.type === 'connector' ? 'continuation' : 'connector'}`,
            block: {
              name: block.type === 'connector' ? 'continuation' : 'connector',
            },
          },
        }}
        keyPressed={keyPressed}
        searchValue={valueToSearch}
        variables={displayVariables}
        submit={submit}
      />
    )
  },
)

export { FBDBlockAutoComplete }
