import * as PrimitiveDropdown from '@radix-ui/react-dropdown-menu'
import { ArrowIcon } from '@root/renderer/assets'
import { useOpenPLCStore } from '@root/renderer/store'
import type { PLCStructureVariable } from '@root/types/PLC/open-plc'
import { baseTypeSchema } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import type { CellContext } from '@tanstack/react-table'
import _ from 'lodash'
import { useEffect, useState } from 'react'

import { ArrayModal } from './elements/array-modal'

type ISelectableCellProps = CellContext<PLCStructureVariable, unknown> & { editable?: boolean }

const SelectableTypeCell = ({
  getValue,
  row: { index },
  column: { id },
  table,
  editable = true,
}: ISelectableCellProps) => {
  const {
    project: {
      data: { dataTypes },
    },
  } = useOpenPLCStore()

  const VariableTypes = [
    { definition: 'base-type', values: baseTypeSchema.options },
    { definition: 'user-data-type', values: dataTypes.map((dataType) => dataType.name) },
  ]

  const { value, definition } = getValue<PLCStructureVariable['type']>()

  const [cellValue, setCellValue] = useState<PLCStructureVariable['type']['value']>(value)
  const [arrayModalIsOpen, setArrayModalIsOpen] = useState(false)
  const [poppoverIsOpen, setPoppoverIsOpen] = useState(false)

  const variableName = table.options.data[index].name

  const onSelect = (
    definition: PLCStructureVariable['type']['definition'],
    value: PLCStructureVariable['type']['value'],
  ) => {
    setCellValue(value)
    table.options.meta?.updateData(index, id, { definition, value })

  }

  useEffect(() => {
    setCellValue(value)
  }, [value])

  return (
    <PrimitiveDropdown.Root onOpenChange={setPoppoverIsOpen} open={poppoverIsOpen}>
      <PrimitiveDropdown.Trigger asChild disabled={definition === 'derived'}>
        <div
          className={cn('flex h-full w-full cursor-pointer justify-center p-2 outline-none', {
            'pointer-events-none': !editable,
            'cursor-default': !editable || definition === 'derived',
          })}
        >
          <span className='line-clamp-1 font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
            {cellValue === null
              ? ''
              : definition === 'array' || definition === 'derived'
                ? cellValue
                : _.upperCase(cellValue as unknown as string)}
          </span>
        </div>
      </PrimitiveDropdown.Trigger>
      <PrimitiveDropdown.Portal>
        <PrimitiveDropdown.Content
          side='bottom'
          sideOffset={-20}
          className='box h-fit w-[200px] overflow-hidden rounded-lg bg-white outline-none dark:bg-neutral-950'
        >
          {VariableTypes.map((scope) => (
            <PrimitiveDropdown.Sub key={scope.definition}>
              <PrimitiveDropdown.SubTrigger asChild>
                <div className='relative flex h-8 w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 data-[state=open]:bg-neutral-100 dark:hover:bg-neutral-900 data-[state=open]:dark:bg-neutral-900'>
                  <span className='font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
                    {_.startCase(scope.definition)}
                  </span>
                  <ArrowIcon size='md' direction='right' className='absolute right-1' />
                </div>
              </PrimitiveDropdown.SubTrigger>
              <PrimitiveDropdown.Portal>
                <PrimitiveDropdown.SubContent
                  sideOffset={5}
                  className='box h-fit w-[200px] overflow-hidden rounded-lg bg-white outline-none dark:bg-neutral-950'
                >
                  {scope.values.map((value) => (
                    <PrimitiveDropdown.Item
                      key={value}
                      onSelect={() => onSelect(scope.definition as PLCStructureVariable['type']['definition'], value)}
                      className='flex h-8 w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
                    >
                      <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
                        {_.upperCase(value)}
                      </span>
                    </PrimitiveDropdown.Item>
                  ))}
                </PrimitiveDropdown.SubContent>
              </PrimitiveDropdown.Portal>
            </PrimitiveDropdown.Sub>
          ))}
          <PrimitiveDropdown.Item asChild>
            <ArrayModal
              variableName={variableName}
              VariableRow={index}
              arrayModalIsOpen={arrayModalIsOpen}
              setArrayModalIsOpen={setArrayModalIsOpen}
              closeContainer={() => setPoppoverIsOpen(false)}
            />
          </PrimitiveDropdown.Item>
        </PrimitiveDropdown.Content>
      </PrimitiveDropdown.Portal>
    </PrimitiveDropdown.Root>
  )
}

export { SelectableTypeCell }
