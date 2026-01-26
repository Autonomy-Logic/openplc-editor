import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@root/utils'
import { Clock, Search, X } from 'lucide-react'
import { memo } from 'react'

type LogLevel = 'debug' | 'info' | 'warning' | 'error'

const levelColors: Record<LogLevel, string> = {
  debug: 'bg-neutral-600 hover:bg-neutral-500',
  info: 'bg-blue-600 hover:bg-blue-500',
  warning: 'bg-yellow-600 hover:bg-yellow-500',
  error: 'bg-red-600 hover:bg-red-500',
}

const ConsoleFilters = memo(() => {
  const filters = useOpenPLCStore((state) => state.filters)
  const consoleActions = useOpenPLCStore((state) => state.consoleActions)

  const toggleLevel = (level: LogLevel) => {
    consoleActions.setLevelFilter(level, !filters.levels[level])
  }

  return (
    <div className='flex items-center gap-2 border-b border-neutral-700 bg-neutral-900 px-3 py-2'>
      {/* Log Level Filters */}
      <div className='flex gap-1'>
        {(['debug', 'info', 'warning', 'error'] as LogLevel[]).map((level) => (
          <button
            key={level}
            onClick={() => toggleLevel(level)}
            className={cn(
              'rounded px-2 py-1 text-xs font-semibold uppercase text-white transition-opacity',
              levelColors[level],
              !filters.levels[level] && 'opacity-30',
            )}
            title={`${filters.levels[level] ? 'Hide' : 'Show'} ${level} logs`}
          >
            {level}
          </button>
        ))}
      </div>

      {/* Search Input */}
      <div className='relative flex-1'>
        <Search className='absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500' />
        <input
          type='text'
          placeholder='Search logs...'
          value={filters.searchTerm}
          onChange={(e) => consoleActions.setSearchTerm(e.target.value)}
          className='w-full rounded bg-neutral-800 py-1 pl-8 pr-8 text-sm text-white placeholder-neutral-500 focus:outline-none focus:ring-1 focus:ring-brand'
        />
        {filters.searchTerm && (
          <button
            onClick={() => consoleActions.setSearchTerm('')}
            className='absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300'
          >
            <X className='h-4 w-4' />
          </button>
        )}
      </div>

      {/* Relative Time Toggle */}
      <button
        onClick={() => consoleActions.setShowRelativeTime(!filters.showRelativeTime)}
        className={cn(
          'flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold transition-colors',
          filters.showRelativeTime
            ? 'bg-brand text-white hover:bg-brand-dark'
            : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700',
        )}
        title={filters.showRelativeTime ? 'Show absolute time' : 'Show relative time'}
      >
        <Clock className='h-3 w-3' />
        Relative
      </button>

      {/* Clear Logs Button */}
      <button
        onClick={consoleActions.clearLogs}
        className='rounded bg-neutral-800 px-3 py-1 text-xs font-semibold text-neutral-400 transition-colors hover:bg-red-600 hover:text-white'
      >
        Clear
      </button>
    </div>
  )
})

export { ConsoleFilters }
