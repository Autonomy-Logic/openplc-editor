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
    colorText: string
  }
> = {
  debug: {
    label: 'Debug',
    colorDot: 'bg-neutral-500 dark:bg-neutral-400',
    colorText: 'text-neutral-600 dark:text-neutral-400',
  },
  info: {
    label: 'Info',
    colorDot: 'bg-blue-500',
    colorText: 'text-blue-600 dark:text-blue-400',
  },
  warning: {
    label: 'Warning',
    colorDot: 'bg-yellow-500',
    colorText: 'text-yellow-600 dark:text-yellow-400',
  },
  error: {
    label: 'Error',
    colorDot: 'bg-red-500',
    colorText: 'text-red-600 dark:text-red-400',
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
    <div className='flex items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900'>
      {/* Log Level Filters Dropdown */}
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            className='flex items-center gap-2 rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
            title='Filter by log level'
          >
            <span className='text-xs'>Levels</span>
            {activeFiltersCount < 4 && (
              <span className='flex h-5 w-5 items-center justify-center rounded-full bg-brand text-xs text-white'>
                {activeFiltersCount}
              </span>
            )}
            <ChevronDownIcon className='h-4 w-4' />
          </button>
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            className='z-50 w-48 rounded-md border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-800'
            sideOffset={5}
            align='start'
          >
            <div className='space-y-1'>
              {(['debug', 'info', 'warning', 'error'] as LogLevel[]).map((level) => (
                <label
                  key={level}
                  className='flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-700'
                >
                  <input
                    type='checkbox'
                    checked={filters.levels[level]}
                    onChange={() => toggleLevel(level)}
                    className='h-4 w-4 cursor-pointer rounded border-neutral-300 text-brand focus:ring-2 focus:ring-brand focus:ring-offset-0 dark:border-neutral-600'
                  />
                  <div className='flex flex-1 items-center gap-2'>
                    <span className={cn('h-2 w-2 rounded-full', levelConfig[level].colorDot)} />
                    <span className={cn('text-sm font-medium', levelConfig[level].colorText)}>
                      {levelConfig[level].label}
                    </span>
                  </div>
                </label>
              ))}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {/* Search Input */}
      <div className='relative flex-1'>
        <MagnifierIcon className='absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 stroke-neutral-400 dark:stroke-neutral-500' />
        <input
          type='text'
          placeholder='Search logs...'
          value={filters.searchTerm}
          onChange={(e) => consoleActions.setSearchTerm(e.target.value)}
          className='w-full rounded border border-neutral-300 bg-white py-1.5 pl-8 pr-8 text-sm text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-brand dark:border-neutral-600 dark:bg-neutral-800 dark:text-white dark:placeholder-neutral-500'
        />
        {filters.searchTerm && (
          <button
            onClick={() => consoleActions.setSearchTerm('')}
            className='absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300'
          >
            <CloseIcon className='h-4 w-4 stroke-current' />
          </button>
        )}
      </div>

      {/* Relative Time Toggle */}
      <button
        onClick={() => consoleActions.setShowRelativeTime(!filters.showRelativeTime)}
        className={cn(
          'flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm font-medium transition-colors',
          filters.showRelativeTime
            ? 'border-brand bg-brand text-white hover:bg-brand-dark'
            : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700',
        )}
        title={filters.showRelativeTime ? 'Show absolute time' : 'Show relative time'}
      >
        <span className='text-sm'>🕐</span>
        <span className='text-xs'>Relative</span>
      </button>

      {/* Clear Logs Button */}
      <button
        onClick={clearPlcLogs}
        className='rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:border-red-500 hover:bg-red-50 hover:text-red-600 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:border-red-500 dark:hover:bg-red-950 dark:hover:text-red-400'
      >
        Clear
      </button>
    </div>
  )
})

export { PlcLogsFilters }
