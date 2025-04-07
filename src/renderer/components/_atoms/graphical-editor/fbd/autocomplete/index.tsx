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
import { customNodeTypes } from '..'
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
      fbdFlows,
      // projectActions: { createVariable },
    } = useOpenPLCStore()

    const block = unknownBlock as Node<BasicNodeData>
    const { edges, pou, variables, rung } = useMemo(() => {
      return getFBDPouVariablesRungNodeAndEdges(editor, pous, fbdFlows, {
        nodeId: block.id,
      })
    }, [pous, fbdFlows, editor, block.id])

    const variableRestrictions = useMemo(() => {
      switch (block.type as keyof typeof customNodeTypes) {
        case 'input-variable':
        case 'output-variable': {
          const connections =
            block.type === 'input-variable'
              ? edges.source?.filter((edge) => edge.target === block.id) ?? []
              : edges.source?.filter((edge) => edge.source === block.id) ?? []
          const restrictions: {
            values: string[]
            definition: string[]
          } = {
            values: [],
            definition: [],
          }
          connections?.forEach((edge) => {
            const connectedNode = rung?.nodes.find((node) => node.id === edge.target)
            const variableType = (connectedNode?.data.variant as BlockVariant).variables.find(
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
            ...restrictions,
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
        ? rung
          ? (rung.nodes
              .filter((node) => (block.type === 'connector' ? node.type === 'continuation' : node.type === 'connector'))
              .map((node) => {
                return node.data.variable
              })
              .filter((name) => name !== '') as PLCVariable[])
          : ([] as PLCVariable[])
        : ([] as PLCVariable[])

    const submit = ({ variable }: { variable: { id: string; name: string } }) => {
      if (variable.id === 'add') {
        return
      }

      // const selectedVariable =
      //   filteredVariables.find((v) => v.id === variable.id) ?? filteredVariables.find((v) => v.name === variable.name)
      // if (!selectedVariable) {
      //   return
      // }
    }

    return (
      <GraphicalEditorAutocomplete
        ref={ref}
        className={cn('h-[200px] w-[200px] overflow-auto', isOpen ? 'block' : 'hidden')}
        isOpen={isOpen}
        setIsOpen={setIsOpen}
        canCreateNewVariable={block.type === 'connector' || block.type === 'continuation'}
        keyPressed={keyPressed}
        searchValue={valueToSearch}
        variables={filteredVariables}
        submit={submit}
      />
    )
  },
)

export { FBDBlockAutoComplete }
