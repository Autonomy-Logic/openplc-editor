import type { EtherCATMasterConfig } from '@root/backend/shared/types/PLC/open-plc'
import { InputWithRef } from '@root/frontend/components/_atoms/input'
import { cn } from '@root/frontend/utils/cn'

type AdvancedTabProps = {
  masterConfig: EtherCATMasterConfig
  onUpdateMasterConfig: (updates: Partial<EtherCATMasterConfig>) => void
}

const inputClassName =
  'h-[30px] w-full rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption !text-xs font-medium text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'

const AdvancedTab = ({ masterConfig, onUpdateMasterConfig }: AdvancedTabProps) => {
  return (
    <div className='flex flex-col gap-6 overflow-auto pb-4'>
      {/* Enable Plugin */}
      <div className='rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900'>
        <h3 className='mb-3 text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400'>Enable Bus</h3>
        <div className='flex items-center gap-4'>
          <label className='relative inline-flex cursor-pointer items-center'>
            <input
              type='checkbox'
              checked={masterConfig.enabled ?? true}
              onChange={(e) => onUpdateMasterConfig({ enabled: e.target.checked })}
              className='peer sr-only'
            />
            <div
              className={cn(
                'h-6 w-11 rounded-full bg-neutral-300 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[""]',
                'peer-checked:bg-brand peer-checked:after:translate-x-full',
                'dark:bg-neutral-700 dark:peer-checked:bg-brand',
              )}
            />
          </label>
          <span className='text-xs text-neutral-600 dark:text-neutral-400'>
            {(masterConfig.enabled ?? true) ? 'EtherCAT bus will start when PLC runs' : 'EtherCAT bus is disabled'}
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

      {/* Task Priority */}
      <div className='rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900'>
        <h3 className='mb-3 text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400'>Task Priority</h3>
        <div className='flex flex-col gap-1'>
          <InputWithRef
            type='number'
            value={masterConfig.taskPriority ?? 1}
            onChange={(e) => onUpdateMasterConfig({ taskPriority: Number(e.target.value) })}
            onBlur={(e) => {
              const val = Number(e.target.value)
              if (!val || val < 1) onUpdateMasterConfig({ taskPriority: 1 })
              else if (val > 31) onUpdateMasterConfig({ taskPriority: 31 })
            }}
            min={1}
            max={31}
            className={cn(inputClassName, 'max-w-[200px]')}
          />
          <span className='text-[10px] text-neutral-500 dark:text-neutral-500'>
            Priority of the EtherCAT cyclic task (1 - 31)
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

export { AdvancedTab }
