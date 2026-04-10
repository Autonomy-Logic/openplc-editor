import { ArrowIcon } from '@root/frontend/assets/icons/interface/Arrow'
import { InputWithRef } from '@root/frontend/components/_atoms/input'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@root/frontend/components/_atoms/select'
import { cn } from '@root/frontend/utils/cn'
import type { NetworkInterface } from '@root/types/ethercat'
import type { EtherCATMasterConfig } from '@root/types/PLC/open-plc'

type GlobalSettingsTabProps = {
  masterConfig: EtherCATMasterConfig
  onUpdateMasterConfig: (updates: Partial<EtherCATMasterConfig>) => void
  isConnectedToRuntime: boolean
  interfaces: NetworkInterface[]
  isLoadingInterfaces: boolean
  onRefreshInterfaces: () => void
}

const inputClassName =
  'h-[30px] w-full rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption !text-xs font-medium text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'

const GlobalSettingsTab = ({
  masterConfig,
  onUpdateMasterConfig,
  isConnectedToRuntime,
  interfaces,
  isLoadingInterfaces,
  onRefreshInterfaces,
}: GlobalSettingsTabProps) => {
  return (
    <div className='flex flex-col gap-6 overflow-auto pb-4'>
      {/* Network Interface */}
      <div className='rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900'>
        <h3 className='mb-3 text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400'>
          Network Interface
        </h3>
        <div className='flex flex-col gap-1'>
          {isConnectedToRuntime && interfaces.length > 0 ? (
            <div className='flex items-center gap-2'>
              <Select
                value={masterConfig.networkInterface}
                onValueChange={(value) => onUpdateMasterConfig({ networkInterface: value })}
              >
                <SelectTrigger
                  withIndicator
                  placeholder='Select interface'
                  className='flex h-[30px] w-full max-w-[320px] items-center justify-between gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-xs font-medium text-neutral-700 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-300'
                />
                <SelectContent className='h-fit max-h-[200px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-300 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'>
                  {interfaces.map((iface) => (
                    <SelectItem
                      key={iface.name}
                      value={iface.name}
                      className={cn(
                        'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
                        'flex w-full cursor-pointer flex-col items-start justify-start px-2 py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800',
                      )}
                    >
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
                onClick={onRefreshInterfaces}
                disabled={isLoadingInterfaces}
                className={cn(
                  'flex h-[30px] w-[30px] items-center justify-center rounded-md border border-neutral-300 bg-white transition-colors',
                  'hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-950 dark:hover:bg-neutral-800',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
                title='Refresh interfaces'
              >
                <ArrowIcon
                  size='sm'
                  className={cn('rotate-180 stroke-brand transition-transform', isLoadingInterfaces && 'animate-spin')}
                />
              </button>
            </div>
          ) : (
            <InputWithRef
              type='text'
              value={masterConfig.networkInterface}
              onChange={(e) => onUpdateMasterConfig({ networkInterface: e.target.value })}
              placeholder='eth0'
              className={cn(inputClassName, 'max-w-[320px]')}
            />
          )}
          <span className='text-[10px] text-neutral-500 dark:text-neutral-500'>
            {isConnectedToRuntime && interfaces.length > 0
              ? 'Select from runtime interfaces'
              : 'Interface name on the runtime host (e.g. eth0, enp3s0)'}
          </span>
        </div>
      </div>

      {/* Cycle Time */}
      <div className='rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900'>
        <h3 className='mb-3 text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400'>
          Cycle Time (microseconds)
        </h3>
        <div className='flex flex-col gap-1'>
          <InputWithRef
            type='number'
            value={masterConfig.cycleTimeUs}
            onChange={(e) => onUpdateMasterConfig({ cycleTimeUs: Number(e.target.value) })}
            onBlur={(e) => {
              const val = Number(e.target.value)
              if (!val || val < 100) onUpdateMasterConfig({ cycleTimeUs: 100 })
              else if (val > 100000) onUpdateMasterConfig({ cycleTimeUs: 100000 })
            }}
            min={100}
            max={100000}
            className={cn(inputClassName, 'max-w-[200px]')}
          />
          <span className='text-[10px] text-neutral-500 dark:text-neutral-500'>
            EtherCAT bus cycle time in microseconds (100 - 100000)
          </span>
        </div>
      </div>

      {/* Watchdog Timeout */}
      <div className='rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900'>
        <h3 className='mb-3 text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400'>
          Watchdog Timeout (cycles)
        </h3>
        <div className='flex flex-col gap-1'>
          <InputWithRef
            type='number'
            value={masterConfig.watchdogTimeoutCycles ?? 3}
            onChange={(e) => onUpdateMasterConfig({ watchdogTimeoutCycles: Number(e.target.value) })}
            onBlur={(e) => {
              const val = Number(e.target.value)
              if (!val || val < 1) onUpdateMasterConfig({ watchdogTimeoutCycles: 1 })
              else if (val > 100) onUpdateMasterConfig({ watchdogTimeoutCycles: 100 })
            }}
            min={1}
            max={100}
            className={cn(inputClassName, 'max-w-[200px]')}
          />
          <span className='text-[10px] text-neutral-500 dark:text-neutral-500'>
            Number of missed cycles before watchdog triggers (1 - 100)
          </span>
        </div>
      </div>
    </div>
  )
}

export { GlobalSettingsTab }
