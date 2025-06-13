import { cn } from '@root/utils'
import _ from 'lodash'

import { Select, SelectContent, SelectItem, SelectTrigger } from '..'

export const GenericSelectCell = ({
  value,
  onValueChange,
  selectValues,
  selected = true,
}: {
  value: string
  onValueChange: (value: string) => void
  selectValues: {
    id: string
    value: string
    label?: string
  }[]
  selected?: boolean
}) => {
  return (
    <Select value={value} onValueChange={(value) => onValueChange(value)}>
      <SelectTrigger
        placeholder={value}
        className={cn(
          'flex h-full w-full justify-center p-2 font-caption text-cp-sm font-medium text-neutral-850 outline-none dark:text-neutral-300',
          { 'pointer-events-none': !selected },
        )}
      />
      <SelectContent
        position='popper'
        side='bottom'
        sideOffset={-20}
        className='box h-fit w-[200px] overflow-hidden rounded-lg bg-white outline-none dark:bg-neutral-950'
      >
        {selectValues.map((sv) => (
          <SelectItem
            key={sv.id}
            value={sv.value}
            className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
          >
            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
              {_.startCase(sv.label) || sv.value}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
