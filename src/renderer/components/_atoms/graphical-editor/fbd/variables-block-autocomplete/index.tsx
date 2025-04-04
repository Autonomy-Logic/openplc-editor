import { useOpenPLCStore } from '@root/renderer/store'
import { extractNumberAtEnd } from '@root/renderer/store/slices/project/validation/variables'
import { PLCVariable } from '@root/types/PLC'
import { cn } from '@root/utils'
import { ComponentPropsWithRef, forwardRef } from 'react'

import { GraphicalEditorAutocomplete } from '../../autocomplete'

type VariablesBlockAutoCompleteProps = ComponentPropsWithRef<'div'> & {
  block: unknown
  blockType?: 'variable' | 'coil' | 'contact' | 'block' | 'other'
  isOpen?: boolean
  setIsOpen?: (isOpen: boolean) => void
  keyPressed?: string
  valueToSearch: string
}

const blockTypeRestrictions = (_block: unknown, blockType: VariablesBlockAutoCompleteProps['blockType']) => {
  switch (blockType) {
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
      // projectActions: { createVariable },
    } = useOpenPLCStore()

    const pou = pous.find((pou) => pou.data.name === editor.meta.name)
    const variables = pou?.data.variables || []
    const _variableRestrictions = blockTypeRestrictions(block, blockType)

    const filteredVariables =
      blockType !== 'block'
        ? variables
            .filter(
              (variable) => variable.name.toLowerCase().includes(valueToSearch.toLowerCase()),
              // Variable type restrictions
              // (variableRestrictions.values === undefined ||
              //   variableRestrictions.values.includes(variable.type.value.toLowerCase())) &&
              // (variableRestrictions.limitations === undefined ||
              //   !variableRestrictions.limitations.includes(variable.type.definition)),
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
    console.log('filteredVariables', filteredVariables)

    const submit = ({ variable }: { variable: { id: string; name: string } }) => {
      if (variable.id === 'add') {
        return
      }

      const selectedVariable =
        filteredVariables.find((v) => v.id === variable.id) ?? filteredVariables.find((v) => v.name === variable.name)
      if (!selectedVariable) {
        return
      }
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
