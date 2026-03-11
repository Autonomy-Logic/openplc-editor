import type { LogObject } from '../../../providers/platform/ports/types'

export type LogLevel = 'debug' | 'info' | 'warning' | 'error'

export type TimestampFormat = 'full' | 'time' | 'none'

export type ConsoleFilters = {
  levels: Record<LogLevel, boolean>
  searchTerm: string
  timestampFormat: TimestampFormat
}

export type ConsoleState = {
  logs: LogObject[]
  filters: ConsoleFilters
}

export type ConsoleActions = {
  addLog: (log: LogObject) => void
  removeLog: (id: string) => void
  clearLogs: () => void
  setLevelFilter: (level: LogLevel, enabled: boolean) => void
  setSearchTerm: (term: string) => void
  setTimestampFormat: (format: TimestampFormat) => void
}

export type ConsoleSlice = ConsoleState & {
  consoleActions: ConsoleActions
}
