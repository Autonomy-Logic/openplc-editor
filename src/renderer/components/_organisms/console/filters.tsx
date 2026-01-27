import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@root/utils'
import { ChevronDown, Filter, Search, X } from 'lucide-react'
import { memo, useMemo, useState } from 'react'

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

const ConsoleFilters = memo(() => {
  const filters = useOpenPLCStore((state) => state.filters)
  const consoleActions = useOpenPLCStore((state) => state.consoleActions)
  const [isExpanded, setIsExpanded] = useState(false)

  const toggleLevel = (level: LogLevel) => {
    consoleActions.setLevelFilter(level, !filters.levels[level])
  }

  const activeFiltersCount = useMemo(() => {
    return Object.values(filters.levels).filter(Boolean).length
  }, [filters.levels])

  const hasActiveFilters = useMemo(() => {
    return activeFiltersCount < 4 || filters.searchTerm || filters.showRelativeTime
  }, [activeFiltersCount, filters.searchTerm, filters.showRelativeTime])

  return (
    <div className='relative'>
      {/* Filter Toggle Button */}
      <button
        type='button'
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          'flex h-7 w-fit select-none items-center gap-1 rounded-lg px-2 transition-colors',
          hasActiveFilters
            ? 'bg-brand text-white hover:bg-brand-medium-dark'
            : 'bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-850 dark:hover:bg-neutral-900',
        )}
      >
        <Filter className='h-3.5 w-3.5' />
        <span className='font-caption text-cp-base font-normal'>Filters</span>
        {hasActiveFilters && (
          <span className='flex h-4 w-4 items-center justify-center rounded-full bg-white text-[10px] font-semibold text-brand'>
            {activeFiltersCount}
          </span>
        )}
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-180')} />
      </button>

      {/* Expandable Filter Panel */}
      {isExpanded && (
        <div className='absolute right-0 top-9 z-50 w-96 rounded-lg border border-neutral-100 bg-white p-3 shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'>
          <div className='flex flex-col gap-3'>
            {/* Search Input */}
            <div className='relative'>
              <Search className='absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 stroke-neutral-400 dark:stroke-neutral-500' />
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
                  <X className='h-3.5 w-3.5' />
                </button>
              )}
            </div>

            {/* Log Levels */}
            <div>
              <label className='mb-2 block text-xs font-medium text-neutral-850 dark:text-neutral-300'>
                Log Levels
              </label>
              <div className='space-y-1.5'>
                {(['debug', 'info', 'warning', 'error'] as LogLevel[]).map((level) => (
                  <label
                    key={level}
                    className='flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-900'
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
                      <span className='text-xs font-medium text-neutral-850 dark:text-neutral-300'>
                        {levelConfig[level].label}
                      </span>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Relative Time Toggle */}
            <div className='flex items-center justify-between'>
              <span className='text-xs font-medium text-neutral-850 dark:text-neutral-300'>Relative Time</span>
              <button
                onClick={() => consoleActions.setShowRelativeTime(!filters.showRelativeTime)}
                className={cn(
                  'flex h-7 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
                  filters.showRelativeTime
                    ? 'border-brand bg-brand text-white hover:bg-brand-medium-dark'
                    : 'border-neutral-300 bg-white text-neutral-850 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-850',
                )}
                title={filters.showRelativeTime ? 'Show absolute time' : 'Show relative time'}
              >
                <span className='text-sm leading-none'>🕐</span>
                <span>{filters.showRelativeTime ? 'On' : 'Off'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
})

export { ConsoleFilters }
