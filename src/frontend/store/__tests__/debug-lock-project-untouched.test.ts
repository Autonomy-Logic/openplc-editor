import { executeTool, TOOL_ACCESS, type ToolName } from '../../services/ai/tools/tool-executor'
import type { OpenPLCStore } from '../index'
import { selectIsEditingLocked } from '../slices/workspace/selectors'
import { createTestStore } from '../testing'

let store: OpenPLCStore

const seedTank = () => {
  expect(store.getState().pouActions.create({ type: 'program', name: 'main', language: 'ld' }).ok).toBe(true)
  expect(
    store.getState().projectActions.createVariable({
      scope: 'local',
      associatedPou: 'main',
      data: {
        name: 'PUMP_RUN',
        class: 'local',
        type: { definition: 'base-type', value: 'bool' },
        location: '',
        documentation: '',
      },
    }).ok,
  ).toBe(true)
  expect(store.getState().projectActions.createServer({ data: { name: 'OPCUA1', protocol: 'opcua' } }).ok).toBe(true)
}

const projectSnapshot = () => JSON.stringify(store.getState().project.data)

const writeTools = (Object.keys(TOOL_ACCESS) as ToolName[]).filter((tool) => TOOL_ACCESS[tool] === 'write')

/** Every write the store exposes that a locked path would otherwise reach. */
const attemptEveryWrite = async () => {
  for (const tool of writeTools) {
    await executeTool(store, tool, { name: 'main', pouName: 'main', body: 'X := 1;', rungIndex: 0, elements: [] })
  }
}

describe('a debug session leaves the project untouched (TC27)', () => {
  beforeEach(() => {
    store = createTestStore()
    seedTank()
  })

  it('should leave the project data unchanged after every write is attempted', async () => {
    const before = projectSnapshot()
    store.getState().workspaceActions.setDebuggerVisible(true)

    await attemptEveryWrite()

    expect(projectSnapshot()).toBe(before)
  })

  it('should leave the project data unchanged even with the debug column untouched', async () => {
    const before = projectSnapshot()
    store.getState().workspaceActions.setDebuggerVisible(true)

    await attemptEveryWrite()
    store.getState().workspaceActions.clearDebugState()

    expect(projectSnapshot()).toBe(before)
  })
})

describe('everything works again once the debugger closes (TC26)', () => {
  beforeEach(() => {
    store = createTestStore()
    seedTank()
  })

  it('should release the editing lock', () => {
    store.getState().workspaceActions.setDebuggerVisible(true)
    expect(selectIsEditingLocked(store.getState())).toBe(true)

    store.getState().workspaceActions.clearDebugState()

    expect(selectIsEditingLocked(store.getState())).toBe(false)
  })

  it('should let an AI write tool change the project again', async () => {
    store.getState().workspaceActions.setDebuggerVisible(true)
    store.getState().workspaceActions.clearDebugState()

    const result = await executeTool(store, 'create_variable', {
      pouName: 'main',
      name: 'NEW_VAR',
      type: 'INT',
      class: 'local',
    })

    expect(result.success).toBe(true)
    expect(
      store
        .getState()
        .project.data.pous.find((pou) => pou.name === 'main')
        ?.interface?.variables.some((v) => v.name === 'NEW_VAR'),
    ).toBe(true)
  })

  it('should let a variable be added through the store again', () => {
    store.getState().workspaceActions.setDebuggerVisible(true)
    store.getState().workspaceActions.clearDebugState()

    const result = store.getState().projectActions.createVariable({
      scope: 'local',
      associatedPou: 'main',
      data: {
        name: 'TANK_LEVEL',
        class: 'local',
        type: { definition: 'base-type', value: 'int' },
        location: '',
        documentation: '',
      },
    })

    expect(result.ok).toBe(true)
  })
})
