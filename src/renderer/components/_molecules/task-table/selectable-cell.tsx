import { Modal, ModalContent, ModalTitle, ModalTrigger } from '@root/renderer/components/_molecules'
import type { PLCTask } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import type { CellContext } from '@tanstack/react-table'
import _ from 'lodash'
import { useEffect, useState } from 'react'

import { Select, SelectContent, SelectItem, SelectTrigger } from '../../_atoms'
import ArrowButtonGroup from '../../_features/[workspace]/editor/graphical/elements/arrow-button-group'

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

const SelectableIntervalCell = ({ getValue, row: { index }, column: { id }, table }: ISelectableCellProps) => {
  const initialValue = getValue()
  const [intervalModalOpen, setIntervalModalIsOpen] = useState(false)
  const [values, setValues] = useState({
    day: 0,
    hour: 0,
    min: 0,
    sec: 0,
    ms: 0,
    microS: 0,
  })

  const [tempValues, setTempValues] = useState(values)

  useEffect(() => {
    if (typeof initialValue === 'string') {
      const regex = /T#(\d+)d(\d+)h(\d+)m(\d+)s(\d+)ms/
      const match = initialValue.match(regex)
      if (match) {
        setValues({
          day: Number(match[1]),
          hour: Number(match[2]),
          min: Number(match[3]),
          sec: Number(match[4]),
          ms: Number(match[5]),
          microS: 0,
        })
        setTempValues({
          day: Number(match[1]),
          hour: Number(match[2]),
          min: Number(match[3]),
          sec: Number(match[4]),
          ms: Number(match[5]),
          microS: 0,
        })
      }
    }
  }, [initialValue])

  const formattedInterval = `T#${tempValues.day}d${tempValues.hour}h${tempValues.min}m${tempValues.sec}s${tempValues.ms}ms`

  const shouldDisplayInterval = Object.values(values).some((val) => val > 0)

  const handleSave = () => {
    setValues(tempValues)
    table.options.meta?.updateData(index, id, formattedInterval)
    setIntervalModalIsOpen(false)
  }

  const handleClearForm = () => {
    setTempValues({ day: 0, hour: 0, min: 0, sec: 0, ms: 0, microS: 0 })
  }

  const handleIncrement = (field: 'day' | 'hour' | 'min' | 'sec' | 'ms' | 'microS') => {
    setTempValues((prevState) => ({
      ...prevState,
      [field]: Math.min(Number(prevState[field]) + 1, 20), // Update the max value as needed
    }))
  }

  const handleDecrement = (field: 'day' | 'hour' | 'min' | 'sec' | 'ms' | 'microS') => {
    setTempValues((prevState) => ({
      ...prevState,
      [field]: Math.max(Number(prevState[field]) - 1, 0), // Ensure the value does not go below 0
    }))
  }

  return (
    <Modal open={intervalModalOpen} onOpenChange={setIntervalModalIsOpen}>
      <ModalTrigger className='flex h-8 w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 data-[state=open]:bg-neutral-100 dark:hover:bg-neutral-900 data-[state=open]:dark:bg-neutral-900'>
        <span className='font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
          {shouldDisplayInterval ? formattedInterval : ''}
        </span>
      </ModalTrigger>
      <ModalContent
        onClose={handleClearForm}
        className='flex max-h-56  w-fit select-none flex-col  justify-between gap-2 rounded-lg bg-neutral-900 p-8'
      >
        <ModalTitle className='text-xl font-medium text-neutral-950 dark:text-white'>Set interval</ModalTitle>
        <div className='flex h-24 w-full  gap-2'>
          {(['day', 'hour', 'min', 'sec', 'ms', 'microS'] as const).map((interval) => (
            <div
              key={interval}
              className='flex  w-full flex-col justify-center gap-1 font-caption text-xs outline-none'
            >
              <label htmlFor={interval} className='w-full text-neutral-950 dark:text-white'>
                {interval}
              </label>
              <div className='flex gap-1'>
                <input
                  placeholder={tempValues[interval] === 0 ? tempValues[interval].toString() : ''}
                  id={interval}
                  type='number'
                  className={cn(
                    'h-6 w-16 rounded-sm bg-white p-2 text-center text-cp-sm outline-none ring-brand focus:ring-2',
                  )}
                  value={tempValues[interval] > 0 ? tempValues[interval] : ''}
                  onChange={(e) =>
                    setTempValues((prevValues) => ({
                      ...prevValues,
                      [interval]: Number(e.target.value),
                    }))
                  }
                />
                <ArrowButtonGroup
                  onIncrement={() => handleIncrement(interval)}
                  onDecrement={() => handleDecrement(interval)}
                />
              </div>
            </div>
          ))}
        </div>
        <div className='flex  !h-8 w-full justify-evenly gap-7'>
          <button
            onClick={() => setIntervalModalIsOpen(false)}
            className='h-full w-[236px] items-center rounded-lg bg-neutral-100 text-center font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100'
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className={`h-full w-[236px] items-center rounded-lg bg-brand text-center font-medium text-white`}
          >
            Ok
          </button>
        </div>
      </ModalContent>
    </Modal>
  )
}
export { SelectableIntervalCell, SelectableTriggerCell }
