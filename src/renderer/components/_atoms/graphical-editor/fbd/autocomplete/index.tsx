import { buildGenericNode } from '@root/renderer/components/_molecules/graphical-editor/fbd/fbd-utils/nodes'
import { useOpenPLCStore } from '@root/renderer/store'
import { extractNumberAtEnd } from '@root/renderer/store/slices/project/validation/variables'
import { PLCVariable } from '@root/types/PLC'
import { cn } from '@root/utils'
import { Node } from '@xyflow/react'
import { isArray } from 'lodash'
import { ComponentPropsWithRef, forwardRef, useMemo } from 'react'

import { GraphicalEditorAutocomplete } from '../../autocomplete'
import { BlockVariant } from '../../types/block'
import { getVariableRestrictionType } from '../../utils'
import { CustomFbdNodeTypes, customNodeTypes } from '..'
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
    const {
      editor,
      project: {
        data: { pous },
      },
      projectActions: { createVariable },
      fbdFlows,
      fbdFlowActions: { updateNode, addNode },
    } = useOpenPLCStore()

    const block = unknownBlock as Node<BasicNodeData> & { positionAbsoluteX?: number; positionAbsoluteY?: number }
    const { edges, pou, variables, rung } = useMemo(() => {
      return getFBDPouVariablesRungNodeAndEdges(editor, pous, fbdFlows, {
        nodeId: block.id,
      })
    }, [pous, fbdFlows, editor, block.id])

    const variableRestrictions = useMemo(() => {
      switch (block.type as keyof typeof customNodeTypes) {
        case 'input-variable':
        case 'output-variable': {
          const connections = block.type === 'input-variable' ? edges.source : edges.target
          const restrictions: {
            values: string[]
            definition: string[]
          } = {
            values: [],
            definition: [],
          }
          connections?.forEach((edge) => {
            const connectedNode = rung?.nodes.find(
              (node) => node.id === (block.type === 'input-variable' ? edge.target : edge.source),
            )
            if (!connectedNode) return


            const variableType = (connectedNode.data.variant as BlockVariant).variables.find(
              (v) => v.name === edge.targetHandle,
            )?.type.value
            if (!variableType) return
            const restriction = getVariableRestrictionType(variableType)
            restrictions.values = Array.from(
              new Set([
                ...restrictions.values,
                ...(restriction.values
                  ? isArray(restriction.values)
                    ? restriction.values
                    : [restriction.values]
                  : []),
              ]),
            )
            restrictions.definition = Array.from(
              new Set([...restrictions.definition, restriction.definition ?? undefined].filter((v) => v !== undefined)),
            )
          })
          return {
            values: restrictions.values.length > 0 ? restrictions.values : undefined,
            definition: restrictions.definition.length > 0 ? restrictions.definition : undefined,
            limitations: ['derived'],
          }
        }
        default:
          return {
            values: undefined,
            definition: undefined,
            limitations: undefined,
          }
      }
    }, [pou])

    const filteredVariables = block.type?.includes('variable')
      ? variables.all
          .filter(
            (variable) =>
              variable.name.toLowerCase().includes(valueToSearch.toLowerCase()) &&
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
      : block.type === 'connector' || block.type === 'continuation'
        ? (rung?.nodes
            .filter((node) => (block.type === 'connector' ? node.type === 'continuation' : node.type === 'connector'))
            .map((node) => {
              return node.data.variable
            })
            .filter((name) => name !== '') as PLCVariable[]) ?? ([] as PLCVariable[])
        : ([] as PLCVariable[])

    console.log('filteredVariables', filteredVariables)

    const submitVariableToBlock = (variable: PLCVariable) => {
      const { rung, node: variableNode } = getFBDPouVariablesRungNodeAndEdges(editor, pous, fbdFlows, {
        nodeId: block.id,
      })
      if (!rung || !variableNode) return

      updateNode({
        editorName: editor.meta.name,
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
      const { rung, node } = getFBDPouVariablesRungNodeAndEdges(editor, pous, fbdFlows, {
        nodeId: block.id,
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
          id: crypto.randomUUID(),
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
        editorName: editor.meta.name,
        node: newBlock,
      })
    }

    const submit = ({ variable }: { variable: { id: string; name: string } }) => {
      if (variable.id === 'add') {
        submitAddVariable({ variableName: valueToSearch })
        return
      }

      if (variable.id === 'newBlock') {
        submitCreateANewBlock(variable.name as CustomFbdNodeTypes)
        return
      }

      const selectedVariable =
        filteredVariables.find((v) => v.id === variable.id) ?? filteredVariables.find((v) => v.name === variable.name)
      if (!selectedVariable) {
        submitAddVariable({ variableName: valueToSearch })
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
        canCreateNewVariable={!(block.type === 'connector' || block.type === 'continuation')}
        newBlock={{
          canCreate: block.type === 'connector' || block.type === 'continuation',
          options: {
            label: `Add ${block.type === 'connector' ? 'continuation' : 'connector'}`,
            block: {
              name: block.type === 'connector' ? 'continuation' : 'connector',
            },
          },
        }}
        keyPressed={keyPressed}
        searchValue={valueToSearch}
        variables={filteredVariables}
        submit={submit}
      />
    )
  },
)

export { FBDBlockAutoComplete }
