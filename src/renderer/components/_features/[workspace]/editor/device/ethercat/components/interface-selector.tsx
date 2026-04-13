import { ArrowIcon } from '@root/renderer/assets/icons'
import { Label } from '@root/renderer/components/_atoms/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@root/renderer/components/_atoms/select'
import type { NetworkInterface } from '@root/types/ethercat'
import { cn } from '@root/utils'

type InterfaceSelectorProps = {
  interfaces: NetworkInterface[]
  selectedInterface: string
  onSelectInterface: (value: string) => void
  isLoading: boolean
  error: string | null
  onRefresh: () => void
}

const selectTriggerStyles =
  'flex h-[30px] w-full min-w-[200px] max-w-[300px] items-center justify-between gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'

const selectContentStyles =
  'h-fit max-h-[200px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-300 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'

const selectItemStyles = cn(
  'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
  'flex w-full cursor-pointer flex-col items-start justify-start px-2 py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800',
)

/**
 * Network interface selector component for EtherCAT configuration
 */
const InterfaceSelector = ({
  interfaces,
  selectedInterface,
  onSelectInterface,
  isLoading,
  error,
  onRefresh,
}: InterfaceSelectorProps) => {
  return (
    <div className='flex flex-col gap-1'>
      <Label className='text-xs text-neutral-950 dark:text-white'>Network Interface</Label>
      <div className='flex items-center gap-2'>
        <Select
          value={selectedInterface}
          onValueChange={onSelectInterface}
          disabled={isLoading || interfaces.length === 0}
        >
          <SelectTrigger
            withIndicator
            placeholder={isLoading ? 'Loading interfaces...' : 'Select interface'}
            className={selectTriggerStyles}
          />
          <SelectContent className={selectContentStyles}>
            {interfaces.map((iface) => (
              <SelectItem key={iface.name} value={iface.name} className={selectItemStyles}>
                <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                  {iface.name}
                </span>
                {iface.description && (
                  <span className='text-start font-caption text-[10px] font-normal text-neutral-500 dark:text-neutral-400'>
                    {iface.description}
                  </span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <button
          onClick={onRefresh}
          disabled={isLoading}
          className={cn(
            'flex h-[30px] w-[30px] items-center justify-center rounded-md border border-neutral-300 bg-white transition-colors',
            'hover:bg-neutral-100 dark:border-neutral-850 dark:bg-neutral-950 dark:hover:bg-neutral-800',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
          title='Refresh interfaces'
        >
          <ArrowIcon
            size='sm'
            className={cn('rotate-180 stroke-brand transition-transform', isLoading && 'animate-spin')}
          />
        </button>
      </div>

      {error && <p className='text-xs text-red-500 dark:text-red-400'>{error}</p>}

      {!error && interfaces.length === 0 && !isLoading && (
        <p className='text-xs text-neutral-500 dark:text-neutral-400'>No network interfaces available</p>
      )}
    </div>
  )
}

export { InterfaceSelector }
