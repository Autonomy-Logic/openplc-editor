import { createStore } from 'zustand/vanilla'

import type { LogObject } from '../../../middleware/shared/ports/types'
import { createConsoleSlice } from '../slices/console/slice'
import type { ConsoleSlice, LogLevel, TimestampFormat } from '../slices/console/types'

function makeStore() {
  return createStore<ConsoleSlice>()(createConsoleSlice)
}

function makeLog(overrides?: Partial<LogObject>): LogObject {
  return {
    level: overrides?.level ?? 'info',
    message: overrides?.message ?? 'Test message',
    tstamp: overrides?.tstamp,
  }
}

describe('createConsoleSlice', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => {
    store = makeStore()
  })

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------
  it('should have correct initial state', () => {
    const state = store.getState()
    expect(state.logs).toEqual([])
    expect(state.filters).toEqual({
      levels: {
        debug: true,
        info: true,
        warning: true,
        error: true,
      },
      searchTerm: '',
      timestampFormat: 'full',
    })
    expect(state.followRequestId).toBe(0)
  })

  // -------------------------------------------------------------------------
  // addLog
  // -------------------------------------------------------------------------
  it('addLog appends a log entry', () => {
    store.getState().consoleActions.addLog(makeLog({ message: 'Hello' }))

    const { logs } = store.getState()
    expect(logs).toHaveLength(1)
    expect(logs[0].message).toBe('Hello')
    expect(logs[0].level).toBe('info')
  })

  it('addLog assigns a Date when tstamp is not provided', () => {
    const before = new Date()
    store.getState().consoleActions.addLog(makeLog({ tstamp: undefined }))
    const after = new Date()

    const { logs } = store.getState()
    expect(logs[0].tstamp).toBeInstanceOf(Date)
    expect((logs[0].tstamp as Date).getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect((logs[0].tstamp as Date).getTime()).toBeLessThanOrEqual(after.getTime())
  })

  it('addLog preserves an explicit tstamp', () => {
    const explicit = new Date('2025-01-15T12:00:00Z')
    store.getState().consoleActions.addLog(makeLog({ tstamp: explicit }))

    const { logs } = store.getState()
    expect(logs[0].tstamp).toBe(explicit)
  })

  it('addLog appends multiple logs in order', () => {
    store.getState().consoleActions.addLog(makeLog({ message: 'first' }))
    store.getState().consoleActions.addLog(makeLog({ message: 'second' }))
    store.getState().consoleActions.addLog(makeLog({ message: 'third' }))

    const { logs } = store.getState()
    expect(logs.map((l) => l.message)).toEqual(['first', 'second', 'third'])
  })

  it('addLog handles log without level', () => {
    store.getState().consoleActions.addLog({ message: 'bare' })

    const { logs } = store.getState()
    expect(logs).toHaveLength(1)
    expect(logs[0].level).toBeUndefined()
  })

  // -------------------------------------------------------------------------
  // Entry ids — minted by the slice, never by the caller. The list owns its
  // own React keys; a caller logging "Build process started" does not.
  // -------------------------------------------------------------------------
  it('addLog mints an id the caller never supplied', () => {
    store.getState().consoleActions.addLog(makeLog({ message: 'Build process started' }))

    const [log] = store.getState().logs
    expect(log.id).toEqual(expect.any(String))
    expect(log.id).not.toBe('')
  })

  it('addLog gives identical messages distinct ids', () => {
    const { addLog } = store.getState().consoleActions
    addLog(makeLog({ message: 'same' }))
    addLog(makeLog({ message: 'same' }))
    addLog(makeLog({ message: 'same' }))

    const ids = store.getState().logs.map((l) => l.id)
    expect(new Set(ids).size).toBe(3)
  })

  it('addLog does not reuse an id after clearLogs', () => {
    const { addLog, clearLogs } = store.getState().consoleActions
    addLog(makeLog({ message: 'before' }))
    const beforeId = store.getState().logs[0].id

    clearLogs()
    addLog(makeLog({ message: 'after' }))

    expect(store.getState().logs[0].id).not.toBe(beforeId)
  })

  // -------------------------------------------------------------------------
  // clearLogs
  // -------------------------------------------------------------------------
  it('clearLogs removes all logs', () => {
    store.getState().consoleActions.addLog(makeLog())
    store.getState().consoleActions.addLog(makeLog())
    store.getState().consoleActions.addLog(makeLog())

    store.getState().consoleActions.clearLogs()

    expect(store.getState().logs).toEqual([])
  })

  it('clearLogs on empty state is a no-op', () => {
    store.getState().consoleActions.clearLogs()
    expect(store.getState().logs).toEqual([])
  })

  it('clearLogs does not affect filters', () => {
    store.getState().consoleActions.setLevelFilter('debug', false)
    store.getState().consoleActions.setSearchTerm('query')
    store.getState().consoleActions.addLog(makeLog())

    store.getState().consoleActions.clearLogs()

    expect(store.getState().logs).toEqual([])
    expect(store.getState().filters.levels.debug).toBe(false)
    expect(store.getState().filters.searchTerm).toBe('query')
  })

  // -------------------------------------------------------------------------
  // setLevelFilter
  // -------------------------------------------------------------------------
  it('setLevelFilter disables a level', () => {
    store.getState().consoleActions.setLevelFilter('debug', false)

    expect(store.getState().filters.levels.debug).toBe(false)
    expect(store.getState().filters.levels.info).toBe(true)
    expect(store.getState().filters.levels.warning).toBe(true)
    expect(store.getState().filters.levels.error).toBe(true)
  })

  it('setLevelFilter enables a previously disabled level', () => {
    store.getState().consoleActions.setLevelFilter('error', false)
    store.getState().consoleActions.setLevelFilter('error', true)

    expect(store.getState().filters.levels.error).toBe(true)
  })

  it('setLevelFilter can disable all levels', () => {
    const levels: LogLevel[] = ['debug', 'info', 'warning', 'error']
    for (const level of levels) {
      store.getState().consoleActions.setLevelFilter(level, false)
    }

    for (const level of levels) {
      expect(store.getState().filters.levels[level]).toBe(false)
    }
  })

  it('setLevelFilter does not affect other filter properties', () => {
    store.getState().consoleActions.setSearchTerm('search-text')
    store.getState().consoleActions.setTimestampFormat('time')

    store.getState().consoleActions.setLevelFilter('warning', false)

    expect(store.getState().filters.searchTerm).toBe('search-text')
    expect(store.getState().filters.timestampFormat).toBe('time')
  })

  // -------------------------------------------------------------------------
  // setSearchTerm
  // -------------------------------------------------------------------------
  it('setSearchTerm updates the search term', () => {
    store.getState().consoleActions.setSearchTerm('modbus')

    expect(store.getState().filters.searchTerm).toBe('modbus')
  })

  it('setSearchTerm can be set to empty string', () => {
    store.getState().consoleActions.setSearchTerm('something')
    store.getState().consoleActions.setSearchTerm('')

    expect(store.getState().filters.searchTerm).toBe('')
  })

  it('setSearchTerm does not affect level filters', () => {
    store.getState().consoleActions.setLevelFilter('info', false)

    store.getState().consoleActions.setSearchTerm('query')

    expect(store.getState().filters.levels.info).toBe(false)
  })

  // -------------------------------------------------------------------------
  // setTimestampFormat
  // -------------------------------------------------------------------------
  it('setTimestampFormat updates the timestamp format', () => {
    const formats: TimestampFormat[] = ['full', 'time', 'none']
    for (const format of formats) {
      store.getState().consoleActions.setTimestampFormat(format)
      expect(store.getState().filters.timestampFormat).toBe(format)
    }
  })

  it('setTimestampFormat does not affect other filter properties', () => {
    store.getState().consoleActions.setSearchTerm('kept')
    store.getState().consoleActions.setLevelFilter('debug', false)

    store.getState().consoleActions.setTimestampFormat('none')

    expect(store.getState().filters.searchTerm).toBe('kept')
    expect(store.getState().filters.levels.debug).toBe(false)
  })

  // -------------------------------------------------------------------------
  // requestConsoleFollow
  // -------------------------------------------------------------------------
  it('requestConsoleFollow increments the follow nonce', () => {
    expect(store.getState().followRequestId).toBe(0)
    store.getState().consoleActions.requestConsoleFollow()
    expect(store.getState().followRequestId).toBe(1)
  })

  it('requestConsoleFollow produces a fresh nonce on every call', () => {
    store.getState().consoleActions.requestConsoleFollow()
    store.getState().consoleActions.requestConsoleFollow()
    store.getState().consoleActions.requestConsoleFollow()
    expect(store.getState().followRequestId).toBe(3)
  })

  it('requestConsoleFollow does not affect logs or filters', () => {
    store.getState().consoleActions.addLog({ level: 'info', message: 'kept' })
    store.getState().consoleActions.setSearchTerm('term')

    store.getState().consoleActions.requestConsoleFollow()

    expect(store.getState().logs).toHaveLength(1)
    expect(store.getState().filters.searchTerm).toBe('term')
  })

  // -------------------------------------------------------------------------
  // Carriage-return redraws — a progress bar must stay on one line.
  // -------------------------------------------------------------------------
  describe('addLog with a carriage-return redraw', () => {
    const frame = (message: string, transient = true) =>
      [{ level: 'info' as const, message, transient }, { redraw: true }] as const

    it('overwrites the open line instead of appending', () => {
      const { addLog } = store.getState().consoleActions
      addLog(...frame('Downloading 10%'))
      addLog(...frame('Downloading 60%'))
      addLog(...frame('Downloading 100%'))

      expect(store.getState().logs).toHaveLength(1)
      expect(store.getState().logs[0].message).toBe('Downloading 100%')
    })

    // A progress bar redraws many times a second. Handing each frame a fresh
    // id would make React tear the line's node down and rebuild it every
    // frame; keeping the replaced entry's id updates it in place instead.
    it('keeps the overwritten line id so React updates the node in place', () => {
      const { addLog } = store.getState().consoleActions
      addLog(...frame('Downloading 10%'))
      const openLineId = store.getState().logs[0].id

      addLog(...frame('Downloading 60%'))
      addLog(...frame('Downloading 100%'))

      expect(store.getState().logs[0].id).toBe(openLineId)
    })

    it('starts a new line once a newline has committed the previous one', () => {
      const { addLog } = store.getState().consoleActions
      addLog(...frame('Downloading A 50%'))
      // The frame that arrived with a trailing newline: it still overwrites,
      // but closes the line behind it.
      addLog(...frame('Downloading A done', false))
      addLog(...frame('Downloading B 50%'))

      const { logs } = store.getState()
      expect(logs).toHaveLength(2)
      expect(logs[0].message).toBe('Downloading A done')
      expect(logs[1].message).toBe('Downloading B 50%')
      expect(logs[0].id).not.toBe(logs[1].id)
    })

    it('never overwrites an ordinary log line', () => {
      const { addLog } = store.getState().consoleActions
      addLog({ level: 'info', message: 'Compiling...' })
      addLog(...frame('Downloading 10%'))

      expect(store.getState().logs).toHaveLength(2)
      expect(store.getState().logs[0].message).toBe('Compiling...')
    })

    it('appends when the write is not a redraw, even above an open line', () => {
      const { addLog } = store.getState().consoleActions
      addLog(...frame('Downloading 10%'))
      addLog({ level: 'info', message: 'Unrelated output' })

      expect(store.getState().logs).toHaveLength(2)
    })
  })

  // -------------------------------------------------------------------------
  // SGR colour is split off at ingestion so the rest of the app sees clean text.
  // -------------------------------------------------------------------------
  describe('addLog with SGR colour', () => {
    const ESC = '\u001B'

    it('stores clean text and keeps the styling in segments', () => {
      store.getState().consoleActions.addLog({
        level: 'info',
        message: `${ESC}[93marduino:avr${ESC}[0m   1.8.8`,
      })

      const [log] = store.getState().logs
      expect(log.message).toBe('arduino:avr   1.8.8')
      expect(log.segments?.map((s) => s.text).join('')).toBe('arduino:avr   1.8.8')
      expect(log.segments?.[0].className).toContain('text-yellow-600')
    })

    it('leaves uncoloured logs exactly as they were — no segments allocated', () => {
      store.getState().consoleActions.addLog({ level: 'info', message: 'plain' })

      const [log] = store.getState().logs
      expect(log.message).toBe('plain')
      expect(log.segments).toBeUndefined()
    })
  })
})
