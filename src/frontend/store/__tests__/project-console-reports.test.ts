import type { OpenPLCStore } from '../index'
import type { OpenProjectResponseData } from '../slices/shared/types'
import { createTestStore } from '../testing'

let store: OpenPLCStore

beforeEach(() => {
  store = createTestStore()
})

/** The smallest project the store opens. */
function openData(overrides: Partial<OpenProjectResponseData> = {}): OpenProjectResponseData {
  return {
    meta: { name: 'demo', type: 'plc-project', path: '/projects/demo' },
    projectData: {
      dataTypes: [],
      pous: [],
      configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
    },
    ...overrides,
  }
}

const messages = (): string[] => store.getState().logs.map((log) => log.message)

const countOf = (message: string): number => messages().filter((shown) => shown === message).length

describe('a log kept until a project opens', () => {
  it('is on the Console exactly once after the open, before the project warnings', () => {
    store.getState().consoleActions.addLogWhenProjectOpen({ level: 'error', message: 'download failed' })

    store.getState().sharedWorkspaceActions.handleOpenProjectResponse(openData({ warnings: ['w'] }))

    expect(messages()).toEqual(['download failed', 'w'])
    expect(store.getState().logs[0].level).toBe('error')
    expect(store.getState().logs[1].level).toBe('warning')
  })

  it('comes before the fatal error lines when the project opens empty and read-only', () => {
    store.getState().consoleActions.addLogWhenProjectOpen({ level: 'error', message: 'download failed' })

    store.getState().sharedWorkspaceActions.handleOpenProjectResponse(openData({ fatalErrors: ['main is unreadable'] }))

    const shown = messages()
    expect(shown[0]).toBe('download failed')
    expect(shown[1]).toBe('main is unreadable')
    expect(countOf('download failed')).toBe(1)
    expect(shown.length).toBeGreaterThan(2)
  })

  it('is not added again when another project opens or the same one reloads in place', () => {
    const other = openData({ meta: { name: 'other', type: 'plc-project', path: '/projects/other' } })
    store.getState().consoleActions.addLogWhenProjectOpen({ level: 'error', message: 'download failed' })
    store.getState().sharedWorkspaceActions.handleOpenProjectResponse(openData())

    store.getState().sharedWorkspaceActions.handleOpenProjectResponse(other)
    expect(countOf('download failed')).toBe(0)

    store.getState().sharedWorkspaceActions.handleOpenProjectResponse(other)
    expect(countOf('download failed')).toBe(0)
  })

  it('survives the Console being cleared before the open', () => {
    store.getState().consoleActions.addLogWhenProjectOpen({ level: 'error', message: 'download failed' })

    store.getState().consoleActions.clearLogs()
    store.getState().sharedWorkspaceActions.handleOpenProjectResponse(openData())

    expect(countOf('download failed')).toBe(1)
  })
})

describe('a log added while a project is open', () => {
  it('is on the Console at once and is not added again by a later open', () => {
    store.getState().sharedWorkspaceActions.handleOpenProjectResponse(openData())

    store.getState().consoleActions.addLogWhenProjectOpen({ level: 'error', message: 'download failed' })
    expect(countOf('download failed')).toBe(1)

    store.getState().sharedWorkspaceActions.handleOpenProjectResponse(openData())
    expect(countOf('download failed')).toBe(0)
  })
})

describe('a log added after a project closes', () => {
  it('is kept until the next open when the project closed with nothing unsaved', () => {
    store.getState().sharedWorkspaceActions.handleOpenProjectResponse(openData())
    expect(store.getState().sharedWorkspaceActions.closeProject()).toEqual({ pendingConfirmation: false })

    store.getState().consoleActions.addLogWhenProjectOpen({ level: 'error', message: 'download failed' })
    expect(countOf('download failed')).toBe(0)

    store.getState().sharedWorkspaceActions.handleOpenProjectResponse(openData())
    expect(countOf('download failed')).toBe(1)
  })

  it('is kept until the next open after the project states are cleared', () => {
    store.getState().sharedWorkspaceActions.handleOpenProjectResponse(openData())
    store.getState().sharedWorkspaceActions.clearStatesOnCloseProject()

    store.getState().consoleActions.addLogWhenProjectOpen({ level: 'error', message: 'download failed' })
    expect(countOf('download failed')).toBe(0)

    store.getState().sharedWorkspaceActions.handleOpenProjectResponse(openData())
    expect(countOf('download failed')).toBe(1)
  })
})
