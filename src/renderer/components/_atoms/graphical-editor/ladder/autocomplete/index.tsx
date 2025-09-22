import { useOpenPLCStore } from '@root/renderer/store'
import { extractNumberAtEnd } from '@root/renderer/store/slices/project/validation/variables'
import { PLCVariable } from '@root/types/PLC'
import { cn } from '@root/utils'
import { Node } from '@xyflow/react'
import { ComponentPropsWithRef, forwardRef } from 'react'
import { v4 as uuidv4 } from 'uuid'

import { GraphicalEditorAutocomplete } from '../../autocomplete'
import { getVariableRestrictionType } from '../../utils'
import { BlockNodeData } from '../block'
import { getLadderPouVariablesRungNodeAndEdges } from '../utils'
import { BasicNodeData } from '../utils/types'
import { VariableNode } from '../variable'

type VariablesBlockAutoCompleteProps = ComponentPropsWithRef<'div'> & {
  block: unknown
  blockType?: 'variable' | 'coil' | 'contact' | 'block' | 'other'
  isOpen?: boolean
  setIsOpen?: (isOpen: boolean) => void
  keyPressed?: string
  valueToSearch: string
}

const blockTypeRestrictions = (block: unknown, blockType: VariablesBlockAutoCompleteProps['blockType']) => {
  switch (blockType) {
    case 'contact':
      return {
        values: ['bool'],
        definition: 'base-type',
        limitations: ['derived'],
      }
    case 'variable': {
      const variableType = (block as VariableNode).data.block.variableType.type
      const restriction = getVariableRestrictionType(variableType.value)
      return {
        ...restriction,
        limitations: ['derived'],
      }
    }
    case 'coil':
      return {
        values: ['bool'],
        definition: 'base-type',
        limitations: ['derived'],
      }
    default:
      return {
        values: undefined,
        definition: undefined,
        limitations: undefined,
      }
  }
}

const VariablesBlockAutoComplete = forwardRef<HTMLDivElement, VariablesBlockAutoCompleteProps>(
  (
    { block, blockType = 'other', isOpen, setIsOpen, keyPressed, valueToSearch }: VariablesBlockAutoCompleteProps,
    ref,
  ) => {
    const {
      editor,
      project: {
        data: { pous },
      },
      projectActions: { createVariable },
      ladderFlows,
      ladderFlowActions: { updateNode },
    } = useOpenPLCStore()

    const pou = pous.find((pou) => pou.data.name === editor.meta.name)
    const variables = pou?.data.variables || []
    const variableRestrictions = blockTypeRestrictions(block, blockType)

    const filteredVariables =
      blockType !== 'block'
        ? variables
            .filter(
              (variable) =>
                variable.name.toLowerCase().includes(valueToSearch.toLowerCase()) &&
                // Variable type restrictions
                (variableRestrictions.values === undefined ||
                  variableRestrictions.values.includes(variable.type.value.toLowerCase())) &&
                (variableRestrictions.limitations === undefined ||
                  !variableRestrictions.limitations.includes(variable.type.definition)),
            )
            .sort((a, b) => {
              const aNumber = extractNumberAtEnd(a.name).number
              const bNumber = extractNumberAtEnd(b.name).number
              if (aNumber === bNumber) {
                return a.name.localeCompare(b.name)
              }
              return aNumber - bNumber
            })
        : []

    const submitVariableToBlock = (variable: PLCVariable) => {
      const { rung, node: variableNode } = getLadderPouVariablesRungNodeAndEdges(editor, pous, ladderFlows, {
        nodeId: (block as Node<BasicNodeData>).id,
      })
      if (!rung || !variableNode) return

      updateNode({
        editorName: editor.meta.name,
        rungId: rung.id,
        nodeId: variableNode.id,
        node: {
          ...variableNode,
          data: {
            ...variableNode.data,
            variable: variable,
          },
        },
      })

      // Check if the variable is connected to a block
      if ((variableNode as VariableNode).data.block === undefined) return

      // Get the block that is connected to the variable
      const relatedBlock = rung.nodes.find((node) => node.id === (variableNode as VariableNode).data.block.id)
      if (!relatedBlock) return

      // Update the block to include the variable
      updateNode({
        editorName: editor.meta.name,
        rungId: rung.id,
        nodeId: relatedBlock.id,
        node: {
          ...relatedBlock,
          data: {
            ...relatedBlock.data,
            connectedVariables: [
              ...(relatedBlock.data as BlockNodeData<object>).connectedVariables,
              {
                variable: variable,
                type: variableNode.data.variant,
                handleId: (variableNode as VariableNode).data.block.handleId,
              },
            ],
          },
        },
      })
    }

    const submitAddVariable = ({ variableName }: { variableName: string }) => {
      const { rung, node } = getLadderPouVariablesRungNodeAndEdges(editor, pous, ladderFlows, {
        nodeId: (block as Node<BasicNodeData>).id,
      })
      if (!rung || !node) return

      const variableTypeRestriction = {
        definition: variableRestrictions.definition || 'base-type',
        value: variableRestrictions.values
          ? Array.isArray(variableRestrictions.values)
            ? variableRestrictions.values[0]
            : variableRestrictions.values
          : 'dint',
      }
      if (!variableTypeRestriction.definition || !variableTypeRestriction.value) return

      const res = createVariable({
        data: {
          id: uuidv4(),
          name: variableName,
          // @ts-expect-error - type is dynamic
          type: {
            definition: variableTypeRestriction.definition as 'base-type' | 'derived' | 'array' | 'user-data-type',
            value: variableTypeRestriction.value,
          },
          class: 'local',
          location: '',
          documentation: '',
          debug: false,
        },
        scope: 'local',
        associatedPou: editor.meta.name,
      })
      if (!res.ok) return

      const variable = res.data as PLCVariable | undefined

      updateNode({
        editorName: editor.meta.name,
        rungId: rung.id,
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

    const submit = ({ variable }: { variable: { id: string; name: string } }) => {
      if (variable.id === 'add') {
        submitAddVariable({ variableName: valueToSearch })
        return
      }

      const selectedVariable =
        filteredVariables.find((variableItem) => variableItem.id === variable.id) ??
        filteredVariables.find((variableItem) => variableItem.name === variable.name)
      if (!selectedVariable) {
        submitAddVariable({ variableName: valueToSearch })
        return
      }

      submitVariableToBlock(selectedVariable as PLCVariable)
    }

    return (
      <GraphicalEditorAutocomplete
        ref={ref}
        className={cn('h-[200px] w-[200px] overflow-auto', isOpen ? 'block' : 'hidden')}
        isOpen={isOpen}
        setIsOpen={setIsOpen}
        keyPressed={keyPressed}
        searchValue={valueToSearch}
        variables={filteredVariables as PLCVariable[]}
        submit={submit}
      />
    )
  },
)

export { VariablesBlockAutoComplete }
