import type { LogObject } from '../../../../middleware/shared/ports/types'

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
  // Monotonic nonce bumped each time something (e.g. a build start) wants the
  // console to become visible and re-attach to the tail. Consumers compare it
  // to the previous value and, on change, reveal the console panel and perform
  // a single "kick to bottom" so auto-follow resumes — without overriding the
  // user's manual scroll position at any other time.
  followRequestId: number
}

export type ConsoleActions = {
  addLog: (log: LogObject) => void
  removeLog: (id: string) => void
  clearLogs: () => void
  setLevelFilter: (level: LogLevel, enabled: boolean) => void
  setSearchTerm: (term: string) => void
  setTimestampFormat: (format: TimestampFormat) => void
  // Reveal the console and kick it to the latest line (re-engaging auto-follow).
  requestConsoleFollow: () => void
}

export type ConsoleSlice = ConsoleState & {
  consoleActions: ConsoleActions
}
