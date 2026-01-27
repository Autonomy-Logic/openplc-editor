import { useOpenPLCStore } from '@root/renderer/store'
import { TimestampFormat } from '@root/renderer/store/slices/console/types'
import { isV4Logs, RuntimeLogEntry, RuntimeLogLevel } from '@root/types/PLC/runtime-logs'
import { cn, formatTimestamp } from '@root/utils'
import { ChevronDown, Download, Filter, Search, X } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

type LogLevel = 'debug' | 'info' | 'warning' | 'error'
type ExportFormat = 'txt' | 'csv' | 'json'

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

const formatOptions: { value: TimestampFormat; label: string }[] = [
  { value: 'full', label: 'DD-MM-YY HH:MM:SS' },
  { value: 'time', label: 'HH:MM:SS' },
  { value: 'none', label: 'None' },
]

const mapV4LevelToLogLevel = (level: RuntimeLogLevel): LogLevel => {
  switch (level) {
    case 'DEBUG':
      return 'debug'
    case 'INFO':
      return 'info'
    case 'WARNING':
      return 'warning'
    case 'ERROR':
      return 'error'
    default:
      return 'info'
  }
}

const PlcLogsFilters = memo(() => {
  const filters = useOpenPLCStore((state) => state.filters)
  const consoleActions = useOpenPLCStore((state) => state.consoleActions)
  const plcLogs = useOpenPLCStore((state) => state.workspace.plcLogs)
  const [isExpanded, setIsExpanded] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [showFormatMenu, setShowFormatMenu] = useState(false)
  const [panelPosition, setPanelPosition] = useState({ bottom: 0, right: 0 })
  const [exportPosition, setExportPosition] = useState({ top: 0, right: 0 })

  const filterButtonRef = useRef<HTMLButtonElement>(null)
  const exportButtonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const exportMenuRef = useRef<HTMLDivElement>(null)

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        isExpanded &&
        panelRef.current &&
        !panelRef.current.contains(target) &&
        !filterButtonRef.current?.contains(target)
      ) {
        setIsExpanded(false)
      }
      if (
        showExportMenu &&
        exportMenuRef.current &&
        !exportMenuRef.current.contains(target) &&
        !exportButtonRef.current?.contains(target)
      ) {
        setShowExportMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isExpanded, showExportMenu])

  const toggleLevel = (level: LogLevel) => {
    consoleActions.setLevelFilter(level, !filters.levels[level])
  }

  const activeFiltersCount = useMemo(() => {
    return Object.values(filters.levels).filter(Boolean).length
  }, [filters.levels])

  const hasActiveFilters = useMemo(() => {
    return activeFiltersCount < 4 || filters.searchTerm || filters.timestampFormat !== 'full'
  }, [activeFiltersCount, filters.searchTerm, filters.timestampFormat])

  // Calculate panel position when expanded
  useEffect(() => {
    if (isExpanded && filterButtonRef.current) {
      const rect = filterButtonRef.current.getBoundingClientRect()
      setPanelPosition({
        bottom: window.innerHeight - rect.top + 8,
        right: window.innerWidth - rect.right,
      })
    }
  }, [isExpanded])

  // Calculate export menu position
  useEffect(() => {
    if (showExportMenu && exportButtonRef.current) {
      const rect = exportButtonRef.current.getBoundingClientRect()
      setExportPosition({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
      })
    }
  }, [showExportMenu])

  // Get filtered logs for export
  const filteredLogs = useMemo(() => {
    if (isV4Logs(plcLogs)) {
      return plcLogs.filter((entry) => {
        const level = mapV4LevelToLogLevel(entry.level)
        if (!filters.levels[level]) return false
        if (filters.searchTerm) {
          const searchLower = filters.searchTerm.toLowerCase()
          const messageMatch = entry.message.toLowerCase().includes(searchLower)
          const timestampMatch = entry.timestamp.toLowerCase().includes(searchLower)
          if (!messageMatch && !timestampMatch) return false
        }
        return true
      })
    }
    const lines = plcLogs ? plcLogs.split('\n').filter((line: string) => line.trim() !== '') : []
    return filters.searchTerm
      ? lines.filter((line) => line.toLowerCase().includes(filters.searchTerm.toLowerCase()))
      : lines
  }, [plcLogs, filters])

  const exportLogs = useCallback(
    (format: ExportFormat) => {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      let content: string
      let mimeType: string
      let extension: string

      const isV4 = isV4Logs(plcLogs)

      switch (format) {
        case 'json':
          if (isV4) {
            content = JSON.stringify(
              (filteredLogs as RuntimeLogEntry[]).map((log) => ({
                timestamp: log.timestamp,
                level: log.level,
                message: log.message,
              })),
              null,
              2,
            )
          } else {
            content = JSON.stringify(
              (filteredLogs as string[]).map((line) => ({ message: line })),
              null,
              2,
            )
          }
          mimeType = 'application/json'
          extension = 'json'
          break
        case 'csv':
          if (isV4) {
            content = 'Timestamp,Level,Message\n'
            content += (filteredLogs as RuntimeLogEntry[])
              .map((log) => {
                const escapedMessage = `"${log.message.replace(/"/g, '""')}"`
                return `${log.timestamp},${log.level},${escapedMessage}`
              })
              .join('\n')
          } else {
            content = 'Message\n'
            content += (filteredLogs as string[]).map((line) => `"${line.replace(/"/g, '""')}"`).join('\n')
          }
          mimeType = 'text/csv'
          extension = 'csv'
          break
        default:
          if (isV4) {
            content = (filteredLogs as RuntimeLogEntry[])
              .map((log) => `[${formatTimestamp(log.timestamp, 'full')}] [${log.level}]: ${log.message}`)
              .join('\n')
          } else {
            content = (filteredLogs as string[]).join('\n')
          }
          mimeType = 'text/plain'
          extension = 'txt'
      }

      const blob = new Blob([content], { type: mimeType })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `plc-logs-${timestamp}.${extension}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setShowExportMenu(false)
    },
    [filteredLogs, plcLogs],
  )

  const currentFormatLabel = formatOptions.find((opt) => opt.value === filters.timestampFormat)?.label || 'Full'

  return (
    <div className='relative'>
      <div className='flex items-center gap-2'>
        {/* Export Button */}
        <div className='relative'>
          <button
            ref={exportButtonRef}
            type='button'
            onClick={() => setShowExportMenu(!showExportMenu)}
            className='flex h-7 w-fit select-none items-center gap-1 rounded-lg bg-neutral-100 px-2 transition-colors hover:bg-neutral-200 dark:bg-neutral-850 dark:hover:bg-neutral-900'
            title='Export logs'
          >
            <Download className='h-3.5 w-3.5' />
          </button>

          {/* Export Menu - Fixed position */}
          {showExportMenu && (
            <div
              ref={exportMenuRef}
              className='fixed z-[9999] w-32 rounded-lg border border-neutral-100 bg-white py-1 shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
              style={{ top: exportPosition.top, right: exportPosition.right }}
            >
              {(['txt', 'csv', 'json'] as ExportFormat[]).map((format) => (
                <button
                  key={format}
                  onClick={() => exportLogs(format)}
                  className='flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium text-neutral-850 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900'
                >
                  <span className='uppercase'>.{format}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Filter Toggle Button */}
        <button
          ref={filterButtonRef}
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
        </button>
      </div>

      {/* Expandable Filter Panel - Fixed position to escape overflow:hidden */}
      {isExpanded && (
        <div
          ref={panelRef}
          className='fixed z-[9999] max-h-[400px] w-80 overflow-y-auto rounded-lg border border-neutral-100 bg-white p-3 shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
          style={{ bottom: panelPosition.bottom, right: panelPosition.right }}
        >
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

            {/* Settings Section */}
            <div className='space-y-2 border-t border-neutral-200 pt-3 dark:border-neutral-800'>
              {/* Auto-scroll Toggle */}
              <div className='flex items-center justify-between'>
                <span className='text-xs font-medium text-neutral-850 dark:text-neutral-300'>Auto-scroll</span>
                <button
                  onClick={() => consoleActions.setAutoScroll(!filters.autoScroll)}
                  className={cn(
                    'flex h-7 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
                    filters.autoScroll
                      ? 'border-brand bg-brand text-white hover:bg-brand-medium-dark'
                      : 'border-neutral-300 bg-white text-neutral-850 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-850',
                  )}
                  title={filters.autoScroll ? 'Disable auto-scroll' : 'Enable auto-scroll'}
                >
                  <span>{filters.autoScroll ? 'On' : 'Off'}</span>
                </button>
              </div>

              {/* Timestamp Format Dropdown */}
              <div className='flex items-center justify-between'>
                <span className='text-xs font-medium text-neutral-850 dark:text-neutral-300'>Format</span>
                <div className='relative'>
                  <button
                    onClick={() => setShowFormatMenu(!showFormatMenu)}
                    className='flex h-7 items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-850 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-850'
                  >
                    <span>{currentFormatLabel}</span>
                    <ChevronDown className={cn('h-3 w-3 transition-transform', showFormatMenu && 'rotate-180')} />
                  </button>

                  {/* Format Dropdown Menu */}
                  {showFormatMenu && (
                    <div className='absolute bottom-full right-0 z-50 mb-1 w-40 rounded-lg border border-neutral-100 bg-white py-1 shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'>
                      {formatOptions.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => {
                            consoleActions.setTimestampFormat(option.value)
                            setShowFormatMenu(false)
                          }}
                          className={cn(
                            'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-900',
                            filters.timestampFormat === option.value
                              ? 'bg-neutral-100 text-brand dark:bg-neutral-900 dark:text-brand'
                              : 'text-neutral-850 dark:text-neutral-300',
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
})

export { PlcLogsFilters }
