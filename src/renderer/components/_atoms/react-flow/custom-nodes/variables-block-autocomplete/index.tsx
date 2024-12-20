import * as Popover from '@radix-ui/react-popover'
import { PlusIcon } from '@root/renderer/assets'
import { useOpenPLCStore } from '@root/renderer/store'

import { getVariableRestrictionType } from '../utils'
import { VariableNode } from '../variable'

type VariablesBlockAutoCompleteProps = {
  block: unknown
  blockType?: 'variable' | 'coil' | 'contact' | 'block' | 'other'
  isOpen?: boolean
  valueToSearch: string
}

const blockTypeRestrictions = (block: unknown, blockType: VariablesBlockAutoCompleteProps['blockType']) => {
  switch (blockType) {
    case 'contact':
      return ['bool']
    case 'variable': {
      const variableType = (block as VariableNode).data.block.variableType.type.value
      return getVariableRestrictionType(variableType)
    }
    default:
      return undefined
  }
}

const VariablesBlockAutoComplete = ({ block, blockType = 'other', isOpen = true, valueToSearch }: VariablesBlockAutoCompleteProps) => {
  const {
    editor,
    project: {
      data: { pous },
    },
  } = useOpenPLCStore()

  const pou = pous.find((pou) => pou.data.name === editor.meta.name)
  const variables = pou?.data.variables || []
  const variableRestrictions = blockTypeRestrictions(block, blockType)

  const filteredVariables = variables.filter(
    (variable) =>
      variable.name.includes(valueToSearch) &&
      (variableRestrictions === undefined || variableRestrictions.includes(variable.type.value.toLowerCase())),
  )

  return (
    <Popover.Root open={isOpen}>
      <Popover.Trigger />
      <Popover.Portal>
        <Popover.Content
          className='flex w-32 flex-col items-center rounded-lg border-0 bg-white text-xs shadow-lg outline-none'
          side='bottom'
          sideOffset={5}
        >
          {filteredVariables.map((variable) => (
            <div key={variable.name} className='flex h-fit w-full flex-row items-center justify-center p-1'>
              {variable.name}
            </div>
          ))}
          <div className='flex h-fit w-full flex-row items-center justify-center p-1'>
            <PlusIcon className='h-3 w-3 fill-red-600 stroke-red-600' />
            <div className='ml-2'>Add variable</div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export { VariablesBlockAutoComplete }
