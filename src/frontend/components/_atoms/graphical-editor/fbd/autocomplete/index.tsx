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
import { cn } from '../../../../../utils/cn'
import { getLiteralType } from '../../../../../utils/keywords'
import { toast } from '../../../../_features/[app]/toast/use-toast'
import { useBoundPou } from '../../../../_features/[workspace]/editor/graphical/active-context'
import { buildGenericNode } from '../../../../_molecules/graphical-editor/fbd/fbd-utils/nodes'
import { GraphicalEditorAutocomplete } from '../../autocomplete'
import { BlockVariant } from '../../types/block'
import { CustomFbdNodeTypes } from '..'
import { BasicNodeData } from '../utils'
import { getFBDPouVariablesRungNodeAndEdges } from '../utils/utils'

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
    const {
      project: {
        data: { pous },
      },
      projectActions: { createVariable },
      fbdFlows,
      fbdFlowActions: { updateNode, addNode },
    } = useOpenPLCStore()

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

      const { rung: freshRung, node } = getFBDPouVariablesRungNodeAndEdges(pouName, pous, fbdFlows, {
        nodeId: block.id,
      })
      if (!freshRung || !node) return

      const variableType = newVariableTypeForExpected(expectedType)

      const res = createVariable({
        data: {
          id: crypto.randomUUID(),
          name: variableName,
          type: {
            definition: variableType.definition,
            value: variableType.value,
          },
          class: 'local',
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
