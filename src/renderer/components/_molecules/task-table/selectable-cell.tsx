import type { PLCTask } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import type { CellContext } from '@tanstack/react-table'
import _ from 'lodash'
import { useEffect, useState } from 'react'

import { Select, SelectContent, SelectItem, SelectTrigger } from '../../_atoms'
import IntervalModal from './elements/interval-modal'

type ISelectableCellProps = CellContext<PLCTask, unknown> & { editable?: boolean }

const triggerOptions = ['Cyclic', 'Interrupt']

const SelectableTriggerCell = ({
  getValue,
  row: { index },
  column: { id },
  table,
  editable = true,
}: ISelectableCellProps) => {
  const initialValue = getValue()
  // We need to keep and update the state of the cell normally
  const [cellValue, setCellValue] = useState(initialValue)

  const onValueChange = (value: string) => {
    setCellValue(value)
    table.options.meta?.updateData(index, id, value)
  }

  useEffect(() => {
    setCellValue(initialValue)
  }, [initialValue])

  return (
    <Select value={cellValue as string} onValueChange={(value) => onValueChange(value)}>
      <SelectTrigger
        placeholder={cellValue as string}
        className={cn(
          'flex h-full w-full justify-center p-2 font-caption text-cp-sm font-medium text-neutral-850 outline-none dark:text-neutral-300',
          { 'pointer-events-none': !editable },
        )}
      />
      <SelectContent
        position='popper'
        side='bottom'
        sideOffset={-20}
        className='box h-fit w-[200px] overflow-hidden rounded-lg bg-white outline-none dark:bg-neutral-950'
      >
        {triggerOptions.map((option) => (
          <SelectItem
            key={option}
            value={option}
            className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
          >
            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
              {_.startCase(option)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const SelectableIntervalCell = ({ getValue }: ISelectableCellProps) => {
  const { value, definition } = getValue<PLCTask['interval']>()

  console.log(value, definition)
  const [intervalModalOpen, setIntervalModalIsOpen] = useState(false)

  return (
    <div>
      <IntervalModal intervalModalOpen={intervalModalOpen} setIntervalModalIsOpen={setIntervalModalIsOpen} />
    </div>
  )
}

export { SelectableIntervalCell, SelectableTriggerCell }
