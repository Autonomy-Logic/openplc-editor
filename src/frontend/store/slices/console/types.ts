import type { LogObject } from '../../../../middleware/shared/ports/types'

export type LogLevel = 'debug' | 'info' | 'warning' | 'error'

export type TimestampFormat = 'full' | 'time' | 'none'

export type ConsoleFilters = {
  levels: Record<LogLevel, boolean>
  searchTerm: string
  timestampFormat: TimestampFormat
}

/**
 * A log as the store holds it: the caller's {@link LogObject} plus the `id` the slice gives it, the Console list's
 * React key.
 */
export type LogEntry = LogObject & { id: string }

export type ConsoleState = {
  logs: LogEntry[]
  filters: ConsoleFilters
  /** A nonce bumped when the Console should be revealed and scrolled once to its latest line. */
  followRequestId: number
  /** Logs kept by `addLogWhenProjectOpen` until a project opens, oldest first. */
  logsAwaitingProject: LogObject[]
  /** Whether a project is open on the Console: set by `openProjectConsole`, cleared by `closeProjectConsole`. */
  projectConsoleOpen: boolean
}

/** Per-write directives for {@link ConsoleActions.addLog}. */
export type AddLogOptions = {
  /**
   * The line comes from a carriage-return redraw and overwrites the line above it while that line is open
   * (`transient`).
   */
  redraw?: boolean
}

export type ConsoleActions = {
  addLog: (log: LogObject, options?: AddLogOptions) => void
  clearLogs: () => void
  setLevelFilter: (level: LogLevel, enabled: boolean) => void
  setSearchTerm: (term: string) => void
  setTimestampFormat: (format: TimestampFormat) => void
  // Reveal the console and kick it to the latest line (re-engaging auto-follow).
  requestConsoleFollow: () => void
  /** Adds `log` now when a project is open on the Console; otherwise keeps it and adds it at the next `openProjectConsole`. */
  addLogWhenProjectOpen: (log: LogObject) => void
  /** Marks a project open on the Console and adds every kept log once, in the order kept, then forgets them. */
  openProjectConsole: () => void
  /** Marks no project open on the Console; kept logs stay kept. */
  closeProjectConsole: () => void
}

export type ConsoleSlice = ConsoleState & {
  consoleActions: ConsoleActions
}
