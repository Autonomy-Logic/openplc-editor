import { Node } from '@xyflow/react'
import { ComponentPropsWithRef, forwardRef } from 'react'
import { v4 as uuidv4 } from 'uuid'

import { PLCVariable } from '../../../../../../middleware/shared/ports'
import { useOpenPLCStore } from '../../../../../store'
import { extractNumberAtEnd } from '../../../../../store/slices/project/validation/variables'
import { cn } from '../../../../../utils/cn'
import { getLiteralType } from '../../../../../utils/keywords'
import { expandArrayVariables } from '../../../../../utils/PLC/array-variable-utils'
import { toast } from '../../../../_features/[app]/toast/use-toast'
import { useBoundPou } from '../../../../_features/[workspace]/editor/graphical/active-context'
import { GraphicalEditorAutocomplete } from '../../autocomplete'
import { getVariableRestrictionType } from '../../utils'
import { getLadderPouVariablesRungNodeAndEdges } from '../utils'
import { BasicNodeData, BlockNodeData, BlockVariant, LadderBlockConnectedVariables, VariableNode } from '../utils/types'

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
    const pouName = useBoundPou()
    const {
      project: {
        data: { pous },
      },
      projectActions: { createVariable },
      ladderFlows,
      ladderFlowActions: { updateNode },
    } = useOpenPLCStore()

    const pou = pous.find((pou) => pou.name === pouName)
    const variables = pou?.interface?.variables ?? []
    const variableRestrictions = blockTypeRestrictions(block, blockType)

    const expandedVariables = expandArrayVariables(variables)

    const filteredVariables =
      blockType !== 'block'
        ? expandedVariables
            .filter(
              (variable) =>
                variable.name.toLowerCase().includes(valueToSearch.toLowerCase()) &&
                // Variable type restrictions
                (variableRestrictions.values === undefined ||
                  (Array.isArray(variableRestrictions.values)
                    ? variableRestrictions.values
                    : [variableRestrictions.values]
                  )
                    .map((v) => v.toLowerCase())
                    .includes(variable.type.value.toLowerCase())) &&
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
      const { rung, node: variableNode } = getLadderPouVariablesRungNodeAndEdges(pouName, pous, ladderFlows, {
        nodeId: (block as Node<BasicNodeData>).id,
      })
      if (!rung || !variableNode) return

      updateNode({
        editorName: pouName,
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

      const existingConnected = Array.isArray((relatedBlock.data as BlockNodeData<BlockVariant>).connectedVariables)
        ? (relatedBlock.data as BlockNodeData<BlockVariant>).connectedVariables
        : []
      const connectedVariables: LadderBlockConnectedVariables = [
        ...existingConnected.filter(
          (v) =>
            v.type !== variableNode.data.variant || v.handleId !== (variableNode as VariableNode).data.block.handleId,
        ),
        {
          handleId: (variableNode as VariableNode).data.block.handleId,
          handleTableId: (relatedBlock.data as BlockNodeData<BlockVariant>).variant.variables.find(
            (v) => v.name === (variableNode as VariableNode).data.block.handleId,
          )?.id,
          type: (variableNode as VariableNode).data.variant,
          variable: variable,
        },
      ]

      // Update the block to include the variable
      updateNode({
        editorName: pouName,
        rungId: rung.id,
        nodeId: relatedBlock.id,
        node: {
          ...relatedBlock,
          data: {
            ...relatedBlock.data,
            connectedVariables: connectedVariables,
          },
        },
      })
    }

    const submitAddVariable = ({ variableName }: { variableName: string }) => {
      if (!variableName.trim()) {
        // For variable nodes on block handles, clearing the name resets the variable
        // so that a branch (contacts/coils) can be placed on the handle instead.
        if (blockType === 'variable') {
          const { rung, node: variableNode } = getLadderPouVariablesRungNodeAndEdges(pouName, pous, ladderFlows, {
            nodeId: (block as Node<BasicNodeData>).id,
          })
          if (rung && variableNode) {
            updateNode({
              editorName: pouName,
              rungId: rung.id,
              nodeId: variableNode.id,
              node: {
                ...variableNode,
                data: {
                  ...variableNode.data,
                  variable: { id: '', name: '' },
                },
              },
            })
          }
          return
        }

        toast({
          title: 'Invalid variable name',
          description: 'Variable name cannot be empty',
          variant: 'fail',
        })
        return
      }

      const { rung, node } = getLadderPouVariablesRungNodeAndEdges(pouName, pous, ladderFlows, {
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
        associatedPou: pouName,
      })
      if (!res.ok) {
        toast({
          title: res.title ?? 'Error',
          description: res.message ?? 'Failed to create variable',
          variant: 'fail',
        })
        return
      }

      const variable = res.data as PLCVariable | undefined

      updateNode({
        editorName: pouName,
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
        // Check if the input is a literal value (e.g., 2.0, TRUE, 'hello')
        // Literals should be submitted directly to the block, not created as variables
        if (getLiteralType(valueToSearch)) {
          submitVariableToBlock({ name: valueToSearch } as PLCVariable)
          return
        }
        submitAddVariable({ variableName: valueToSearch })
        return
      }

      // Look up in the expanded variables list (includes array elements)
      // This ensures we find the variable even if the filter state changed
      const selectedVariable = expandedVariables.find(
        (variableItem) => variableItem.name.toLowerCase() === variable.name.toLowerCase(),
      )
      if (!selectedVariable) {
        // Don't create a new variable if lookup fails - this prevents accidental variable creation
        // Variables should only be created when the user explicitly selects "Add variable"
        return
      }

      submitVariableToBlock(selectedVariable)
    }

    return (
      <GraphicalEditorAutocomplete
        ref={ref}
        className={cn('h-[200px] w-[200px] overflow-auto', isOpen ? 'block' : 'hidden')}
        isOpen={isOpen}
        setIsOpen={setIsOpen}
        keyPressed={keyPressed}
        searchValue={valueToSearch}
        variables={filteredVariables}
        submit={submit}
      />
    )
  },
)

export { VariablesBlockAutoComplete }
