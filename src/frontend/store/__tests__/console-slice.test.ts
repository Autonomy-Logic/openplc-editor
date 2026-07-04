import { createStore } from 'zustand/vanilla'

import type { LogObject } from '../../../middleware/shared/ports/types'
import { createConsoleSlice } from '../slices/console/slice'
import type { ConsoleSlice, LogLevel, TimestampFormat } from '../slices/console/types'

function makeStore() {
  return createStore<ConsoleSlice>()(createConsoleSlice)
}

function makeLog(overrides?: Partial<LogObject>): LogObject {
  return {
    id: overrides?.id ?? 'log-1',
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
    const log = makeLog({ id: 'log-1', message: 'Hello' })
    store.getState().consoleActions.addLog(log)

    const { logs } = store.getState()
    expect(logs).toHaveLength(1)
    expect(logs[0].id).toBe('log-1')
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
    store.getState().consoleActions.addLog(makeLog({ id: 'a', message: 'first' }))
    store.getState().consoleActions.addLog(makeLog({ id: 'b', message: 'second' }))
    store.getState().consoleActions.addLog(makeLog({ id: 'c', message: 'third' }))

    const { logs } = store.getState()
    expect(logs).toHaveLength(3)
    expect(logs[0].id).toBe('a')
    expect(logs[1].id).toBe('b')
    expect(logs[2].id).toBe('c')
  })

  it('addLog handles log without level', () => {
    store.getState().consoleActions.addLog({ id: 'no-level', message: 'bare' })

    const { logs } = store.getState()
    expect(logs).toHaveLength(1)
    expect(logs[0].level).toBeUndefined()
  })

  // -------------------------------------------------------------------------
  // removeLog
  // -------------------------------------------------------------------------
  it('removeLog removes a log by id', () => {
    store.getState().consoleActions.addLog(makeLog({ id: 'keep' }))
    store.getState().consoleActions.addLog(makeLog({ id: 'remove' }))
    store.getState().consoleActions.addLog(makeLog({ id: 'also-keep' }))

    store.getState().consoleActions.removeLog('remove')

    const { logs } = store.getState()
    expect(logs).toHaveLength(2)
    expect(logs.map((l) => l.id)).toEqual(['keep', 'also-keep'])
  })

  it('removeLog does nothing when id does not exist', () => {
    store.getState().consoleActions.addLog(makeLog({ id: 'existing' }))

    store.getState().consoleActions.removeLog('nonexistent')

    const { logs } = store.getState()
    expect(logs).toHaveLength(1)
    expect(logs[0].id).toBe('existing')
  })

  it('removeLog on empty logs array does not throw', () => {
    expect(() => store.getState().consoleActions.removeLog('anything')).not.toThrow()
    expect(store.getState().logs).toEqual([])
  })

  // -------------------------------------------------------------------------
  // clearLogs
  // -------------------------------------------------------------------------
  it('clearLogs removes all logs', () => {
    store.getState().consoleActions.addLog(makeLog({ id: '1' }))
    store.getState().consoleActions.addLog(makeLog({ id: '2' }))
    store.getState().consoleActions.addLog(makeLog({ id: '3' }))

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
    store.getState().consoleActions.addLog(makeLog({ id: '1' }))

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
    store.getState().consoleActions.addLog({ id: '1', level: 'info', message: 'kept' })
    store.getState().consoleActions.setSearchTerm('term')

    store.getState().consoleActions.requestConsoleFollow()

    expect(store.getState().logs).toHaveLength(1)
    expect(store.getState().filters.searchTerm).toBe('term')
  })
})
