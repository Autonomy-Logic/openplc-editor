import { ChevronDownIcon } from '@radix-ui/react-icons'
import * as Popover from '@radix-ui/react-popover'
import { CloseIcon } from '@root/renderer/assets/icons/interface/Close'
import { MagnifierIcon } from '@root/renderer/assets/icons/interface/Magnifier'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@root/utils'
import { memo, useMemo } from 'react'

type LogLevel = 'debug' | 'info' | 'warning' | 'error'

const levelConfig: Record<
  LogLevel,
  {
    label: string
    colorDot: string
  }
> = {
  debug: {
    label: 'Debug',
    colorDot: 'bg-neutral-500 dark:bg-neutral-400',
  },
  info: {
    label: 'Info',
    colorDot: 'bg-blue-500',
  },
  warning: {
    label: 'Warning',
    colorDot: 'bg-yellow-500',
  },
  error: {
    label: 'Error',
    colorDot: 'bg-red-500',
  },
}

const PlcLogsFilters = memo(() => {
  const filters = useOpenPLCStore((state) => state.filters)
  const consoleActions = useOpenPLCStore((state) => state.consoleActions)
  const clearPlcLogs = useOpenPLCStore((state) => state.workspaceActions.clearPlcLogs)

  const toggleLevel = (level: LogLevel) => {
    consoleActions.setLevelFilter(level, !filters.levels[level])
  }

  const activeFiltersCount = useMemo(() => {
    return Object.values(filters.levels).filter(Boolean).length
  }, [filters.levels])

  return (
    <div className='flex items-center gap-2 border-b border-neutral-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900'>
      {/* Log Level Filters Dropdown */}
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            className='flex items-center gap-2 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-850 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-850'
            title='Filter by log level'
          >
            <span>Levels</span>
            {activeFiltersCount < 4 && (
              <span className='flex h-4 w-4 items-center justify-center rounded-full bg-brand text-[10px] font-semibold text-white'>
                {activeFiltersCount}
              </span>
            )}
            <ChevronDownIcon className='h-3.5 w-3.5' />
          </button>
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            className='z-[100] w-44 rounded-lg border border-neutral-100 bg-white text-neutral-1000 outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950 dark:text-neutral-300'
            sideOffset={5}
            align='start'
          >
            <div className='py-1'>
              {(['debug', 'info', 'warning', 'error'] as LogLevel[]).map((level) => (
                <label
                  key={level}
                  className='flex cursor-pointer items-center gap-2.5 px-3 py-1.5 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-900'
                >
                  <input
                    type='checkbox'
                    checked={filters.levels[level]}
                    onChange={() => toggleLevel(level)}
                    className='peer sr-only'
                  />
                  <div
                    className={cn(
                      'h-4 w-7 rounded-full bg-neutral-300 transition-colors',
                      'after:absolute after:h-3 after:w-3 after:rounded-full after:bg-white after:transition-transform after:content-[""]',
                      'peer-checked:bg-brand peer-checked:after:translate-x-3',
                      'relative after:left-0.5 after:top-0.5',
                      'dark:bg-neutral-700 dark:peer-checked:bg-brand',
                    )}
                  />
                  <div className='flex flex-1 items-center gap-2'>
                    <span className={cn('h-2 w-2 rounded-full', levelConfig[level].colorDot)} />
                    <span className='text-xs font-medium'>{levelConfig[level].label}</span>
                  </div>
                </label>
              ))}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {/* Search Input */}
      <div className='relative flex-1'>
        <MagnifierIcon className='absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 stroke-neutral-400 dark:stroke-neutral-500' />
        <input
          type='text'
          placeholder='Search logs...'
          value={filters.searchTerm}
          onChange={(e) => consoleActions.setSearchTerm(e.target.value)}
          className='h-[28px] w-full rounded-md border border-neutral-300 bg-white px-2 py-1 pl-8 pr-8 text-xs text-neutral-850 placeholder-neutral-400 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300 dark:placeholder-neutral-500'
        />
        {filters.searchTerm && (
          <button
            onClick={() => consoleActions.setSearchTerm('')}
            className='absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300'
          >
            <CloseIcon className='h-3.5 w-3.5 stroke-current' />
          </button>
        )}
      </div>

      {/* Relative Time Toggle */}
      <button
        onClick={() => consoleActions.setShowRelativeTime(!filters.showRelativeTime)}
        className={cn(
          'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
          filters.showRelativeTime
            ? 'border-brand bg-brand text-white hover:bg-brand-medium-dark'
            : 'border-neutral-300 bg-white text-neutral-850 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-850',
        )}
        title={filters.showRelativeTime ? 'Show absolute time' : 'Show relative time'}
      >
        <span className='text-sm leading-none'>🕐</span>
        <span>Relative</span>
      </button>

      {/* Clear Logs Button */}
      <button
        onClick={clearPlcLogs}
        className='rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-850 transition-colors hover:border-red-500 hover:bg-red-50 hover:text-red-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:border-red-500 dark:hover:bg-red-950 dark:hover:text-red-400'
      >
        Clear
      </button>
    </div>
  )
})

export { PlcLogsFilters }
