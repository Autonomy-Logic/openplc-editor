import { Modal, ModalContent, ModalTitle, ModalTrigger } from '@root/renderer/components/_molecules'
import { cn } from '@root/utils'
import { useEffect, useMemo, useState } from 'react'

import ArrowButtonGroup from '../../[workspace]/editor/graphical/elements/arrow-button-group'

type IntervalModalProps = {
  initialValue: string
  onValueChange: (value: string) => void
  onClose: () => void
  open: boolean
}

const IntervalModal = ({ initialValue, onValueChange, onClose, open }: IntervalModalProps) => {
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
    const regex = /T#(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)min)?(?:(\d+)s)?(?:(\d+)ms)?(?:(\d+)µs)?/
    const match = initialValue?.match(regex)

    if (match) {
      const [, day = 0, hour = 0, min = 0, sec = 0, ms = 0, µs = 0] = match.map((v) => (v ? Number(v) : 0))
      const newValues = { day, hour, min, sec, ms, µs }
      setValues(newValues)
      setTempValues(newValues)
    }
  }, [initialValue])

  const formattedInterval = useMemo(() => {
    const { day, hour, min, sec, ms, µs } = values
    return `T#${day > 0 ? `${day}d` : ''}${hour > 0 ? `${hour}h` : ''}${min > 0 ? `${min}min` : ''}${sec > 0 ? `${sec}s` : ''}${ms > 0 ? `${ms}ms` : ''}${µs > 0 ? `${µs}µs` : ''}`
  }, [values])

  const handleSave = () => {
    onValueChange(formattedInterval)
    onClose()
  }

  const handleCancel = () => {
    setTempValues(values)
    onClose()
  }

  const handleValueChange = (field: keyof typeof values, change: number) => {
    setTempValues((prev) => ({ ...prev, [field]: Math.max(0, prev[field] + change) }))
  }

  return (
    <Modal open={open} onOpenChange={onClose}>
      <ModalTrigger
        asChild
        className='flex h-8 w-full cursor-pointer items-center justify-center outline-none dark:hover:bg-neutral-900'
      >
        <div className={cn('flex h-full w-full cursor-pointer justify-center p-2 outline-none')}>
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
                      [interval]: e.target.value ? Number(e.target.value) : 0, // Prevenindo NaN
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

export { IntervalModal }
