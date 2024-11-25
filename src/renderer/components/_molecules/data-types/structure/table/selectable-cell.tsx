import * as PrimitiveDropdown from '@radix-ui/react-dropdown-menu'
import { ArrowIcon } from '@root/renderer/assets'
import type { PLCStructureDatatype } from '@root/types/PLC/open-plc'
import { baseTypeSchema } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import type { CellContext } from '@tanstack/react-table'
import _ from 'lodash'
import { useEffect, useState } from 'react'

type ISelectableCellProps = CellContext<PLCStructureDatatype['variable'], unknown> & { editable?: boolean }

const SelectableTypeCell = ({
  getValue,
  row: { index },
  column: { id },
  table,
  editable = true,
}: ISelectableCellProps) => {
  const variable = getValue<PLCStructureDatatype['variable']>()[1]

  const { type } = variable || { type: { baseType: '', definition: '', value: '' } }

  const [cellValue, setCellValue] = useState(type?.baseType || '')
  const [poppoverIsOpen, setPoppoverIsOpen] = useState(false)

  const onSelect = (definition: string, value: string) => {
    setCellValue(value)
    table.options.meta?.updateData(index, id, { type: { definition, value } })
  }

  useEffect(() => {
    setCellValue(type?.baseType || '')
  }, [type])

  return (
    <PrimitiveDropdown.Root onOpenChange={setPoppoverIsOpen} open={poppoverIsOpen}>
      <PrimitiveDropdown.Trigger asChild>
        <div
          className={cn('flex h-full w-full cursor-pointer justify-center p-2 outline-none', {
            'pointer-events-none': !editable,
          })}
        >
          <span className='line-clamp-1 font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
            {_.startCase(cellValue)}
          </span>
        </div>
      </PrimitiveDropdown.Trigger>
      <PrimitiveDropdown.Portal>
        <PrimitiveDropdown.Content
          side='bottom'
          sideOffset={-20}
          className='box h-fit w-[200px] overflow-hidden rounded-lg bg-white outline-none dark:bg-neutral-950'
        >
          {baseTypeSchema.options.map((type) => (
            <PrimitiveDropdown.Sub key={type}>
              <PrimitiveDropdown.SubTrigger className='flex h-7 items-center justify-between gap-2 px-3 py-2 font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                <span>{_.startCase(type)}</span>
                <ArrowIcon />
              </PrimitiveDropdown.SubTrigger>
              <PrimitiveDropdown.Portal>
                <PrimitiveDropdown.SubContent
                  sideOffset={5}
                  className='box h-fit w-[200px] overflow-hidden rounded-lg bg-white outline-none dark:bg-neutral-950'
                >
                  <PrimitiveDropdown.Item
                    className='flex h-7 items-center justify-between gap-2 px-3 py-2 font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'
                    onSelect={() => onSelect(type, type)}
                  >
                    <span>{_.startCase(type)}</span>
                  </PrimitiveDropdown.Item>
                </PrimitiveDropdown.SubContent>
              </PrimitiveDropdown.Portal>
            </PrimitiveDropdown.Sub>
          ))}
        </PrimitiveDropdown.Content>
      </PrimitiveDropdown.Portal>
    </PrimitiveDropdown.Root>
  )
}

export { SelectableTypeCell }
