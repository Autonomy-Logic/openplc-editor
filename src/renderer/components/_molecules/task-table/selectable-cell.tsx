import { Modal, ModalContent, ModalTitle, ModalTrigger } from '@root/renderer/components/_molecules'
import type { PLCTask } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import type { CellContext } from '@tanstack/react-table'
import _ from 'lodash'
import { useEffect, useMemo, useState } from 'react'

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

const SelectableIntervalCell = ({
  getValue,
  row: { index },
  column: { id },
  editable = true,
  table,
}: ISelectableCellProps) => {
  const initialValue: string = getValue() as string
  const [intervalModalOpen, setIntervalModalIsOpen] = useState(false)
  const [values, setValues] = useState({
    day: 0,
    hour: 0,
    min: 0,
    sec: 0,
    ms: 0,
    µs: 0,
  })
  const [tempValues, setTempValues] = useState(values)

  useEffect(() => {
    const regex = /T#(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)min)?(?:(\d+)s)?(?:(\d+(?:\.\d+)?)ms)?(?:(\d+(?:\.\d+)?)µs)?/

    const match = initialValue?.match(regex)
    console.log('Regex Match:', match)

    if (match) {
      const [, day = 0, hour = 0, min = 0, sec = 0, ms = 0, µs = 0] = match.map((v) => (v ? Number(v) : 0))

      const newValues = {
        day,
        hour,
        min,
        sec,
        ms: Number(ms) + Number(µs) / 1000,
        µs: Number(µs),
      }

      setValues(newValues)
      setTempValues(newValues)
    }
  }, [initialValue])

  useEffect(() => {
    console.log('Current Values:', values)
  }, [values])

  const formattedInterval = useMemo(() => {
    const { day, hour, min, sec, ms, µs } = values
    const totalMs = ms + µs / 1000

    const formattedMs = totalMs % 1 === 0 ? `${Math.floor(totalMs)}ms` : `${totalMs}ms`

    return `T#${day > 0 ? `${day}d` : ''}${hour > 0 ? `${hour}h` : ''}${min > 0 ? `${min}min` : ''}${sec > 0 ? `${sec}s` : ''}${formattedMs === '0ms' ? '' : formattedMs}`
  }, [values])
  const handleSave = () => {
    const updatedValues = { ...tempValues }

    if (tempValues.µs >= 1000) {
      const additionalMs = Math.floor(tempValues.µs / 1000)
      updatedValues.ms += additionalMs
      updatedValues.µs = tempValues.µs % 1000
    }

    if (updatedValues.ms >= 1000) {
      const additionalSec = Math.floor(updatedValues.ms / 1000)
      updatedValues.sec += additionalSec
      updatedValues.ms = updatedValues.ms % 1000
    }

    setValues(updatedValues)
    setTempValues(updatedValues)

    const formattedInterval = `T#${updatedValues.day > 0 ? `${updatedValues.day}d` : ''}${updatedValues.hour > 0 ? `${updatedValues.hour}h` : ''}${updatedValues.min > 0 ? `${updatedValues.min}min` : ''}${updatedValues.sec > 0 ? `${updatedValues.sec}s` : ''}${updatedValues.ms > 0 || updatedValues.µs > 0 ? `${updatedValues.ms + updatedValues.µs / 1000}ms` : ''}`

    table.options.meta?.updateData(index, id, formattedInterval)
    setIntervalModalIsOpen(false)
  }

  const handleCancel = () => {
    setTempValues(values)
    setIntervalModalIsOpen(false)
  }

  const handleValueChange = (field: keyof typeof values, change: number) => {
    setTempValues((prev) => {
      const newValue = Math.max(0, prev[field] + change)
      return {
        ...prev,
        [field]: newValue,
      }
    })
  }

  return (
    <Modal open={intervalModalOpen} onOpenChange={setIntervalModalIsOpen}>
      <ModalTrigger
        asChild
        className='flex h-8 w-full cursor-pointer items-center justify-center outline-none dark:hover:bg-neutral-900'
      >
        <div
          className={cn('flex h-full w-full cursor-pointer justify-center outline-none p-2', {
            'pointer-events-none': !editable,
          })}
        >
          <span className='line-clamp-1 font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
            {formattedInterval}
          </span>
        </div>
      </ModalTrigger>
      <ModalContent
        onClose={handleCancel}
        className='flex max-h-56 w-fit select-none flex-col justify-between gap-2 rounded-lg p-8'
      >
        <ModalTitle className='text-xl font-medium text-neutral-950 dark:text-white'>Set interval</ModalTitle>
        <div className='flex h-24 w-full gap-2'>
          {(['day', 'hour', 'min', 'sec', 'ms', 'µs'] as const).map((interval) => (
            <div key={interval} className='flex w-full flex-col justify-center gap-1 font-caption text-xs'>
              <label htmlFor={interval} className='w-full text-neutral-950 dark:text-white'>
                {interval}
              </label>
              <div className='flex gap-1'>
                <input
                  id={interval}
                  type='number'
                  className='h-[26px] w-16 rounded-lg border border-neutral-300 bg-white p-2 text-center text-xs text-neutral-700 outline-none ring-brand focus:border-brand focus:ring-2 dark:border-neutral-850 dark:bg-neutral-900 dark:text-neutral-100'
                  value={tempValues[interval] || ''}
                  onChange={(e) =>
                    setTempValues((prev) => ({
                      ...prev,
                      [interval]: Number(e.target.value),
                    }))
                  }
                />
                <ArrowButtonGroup
                  onIncrement={() => handleValueChange(interval, 1)}
                  onDecrement={() => handleValueChange(interval, -1)}
                />
              </div>
            </div>
          ))}
        </div>
        <div className='flex h-8 w-full justify-evenly gap-7'>
          <button
            onClick={handleCancel}
            className='h-full w-[236px] rounded-lg bg-neutral-100 text-center font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100'
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className='h-full w-[236px] rounded-lg bg-brand text-center font-medium text-white'
          >
            Ok
          </button>
        </div>
      </ModalContent>
    </Modal>
  )
}
export { SelectableIntervalCell, SelectableTriggerCell }
