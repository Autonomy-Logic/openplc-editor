import { createTestStore } from '../../../../store/testing'
import type { OpenPLCStore } from '../../../../store'
import { executeTool, TOOL_ACCESS, type ToolName } from '../tool-executor'

let store: OpenPLCStore

const openDebugSession = () => store.getState().workspaceActions.setDebuggerVisible(true)

// `read_ladder_diagram` only answers for a Ladder POU and `read_pou_body` needs a
// transpiler for one, so the fixture carries both a Ladder and a textual POU.
const seedProject = () => {
  expect(store.getState().pouActions.create({ type: 'program', name: 'main', language: 'ld' }).ok).toBe(true)
  expect(store.getState().pouActions.create({ type: 'program', name: 'logic', language: 'st' }).ok).toBe(true)
}

const readInputFor = (tool: ToolName): unknown => {
  if (tool === 'read_pou_body') return { name: 'logic' }
  if (tool === 'read_ladder_diagram') return { pouName: 'main' }
  return {}
}

const WRITE_TOOLS: ToolName[] = [
  'create_pou',
  'update_pou_body',
  'delete_pou',
  'create_variable',
  'update_variable',
  'delete_variable',
  'create_datatype',
  'update_datatype',
  'delete_datatype',
  'add_rung',
  'update_rung',
  'delete_rung',
]

const READ_TOOLS: ToolName[] = ['read_project_state', 'read_pou_body', 'read_ladder_diagram']

const validInputFor = (tool: ToolName): unknown => {
  switch (tool) {
    case 'create_pou':
      return { name: 'extra', type: 'program', language: 'st' }
    case 'update_pou_body':
      return { name: 'main', body: 'X := 1;' }
    case 'delete_pou':
      return { name: 'main' }
    case 'create_variable':
      return { pouName: 'main', name: 'NEW_VAR', type: 'INT', class: 'local' }
    case 'update_variable':
      return { pouName: 'main', name: 'NEW_VAR', newName: 'OTHER' }
    case 'delete_variable':
      return { pouName: 'main', name: 'NEW_VAR' }
    case 'create_datatype':
      return { name: 'RecipeT', derivation: 'structure', members: [{ name: 'Temp', type: 'REAL' }] }
    case 'update_datatype':
      return { name: 'RecipeT', newName: 'RecipeU' }
    case 'delete_datatype':
      return { name: 'RecipeT' }
    case 'add_rung':
      return { pouName: 'main', elements: [] }
    case 'update_rung':
      return { pouName: 'main', rungIndex: 0, elements: [] }
    case 'delete_rung':
      return { pouName: 'main', rungIndex: 0 }
    default:
      return { pouName: 'main', name: 'main' }
  }
}

describe('AI tools during a debug session (TC13, TC14)', () => {
  beforeEach(() => {
    store = createTestStore()
    seedProject()
  })

  it('should classify every dispatched tool as read or write', () => {
    for (const tool of [...WRITE_TOOLS, ...READ_TOOLS]) {
      expect(TOOL_ACCESS[tool]).toBeDefined()
    }
    expect(Object.keys(TOOL_ACCESS)).toHaveLength(WRITE_TOOLS.length + READ_TOOLS.length)
  })

  it.each(WRITE_TOOLS)('should refuse the write tool %s while the debugger is open', async (tool) => {
    openDebugSession()

    const result = await executeTool(store, tool, validInputFor(tool))

    expect(result.success).toBe(false)
    expect(result.message.length).toBeGreaterThan(0)
  })

  it('should leave the project untouched when a write tool is refused', async () => {
    const before = JSON.stringify(store.getState().project.data)

    openDebugSession()
    for (const tool of WRITE_TOOLS) {
      await executeTool(store, tool, validInputFor(tool))
    }

    expect(JSON.stringify(store.getState().project.data)).toBe(before)
  })

  it.each(READ_TOOLS)('should still answer the read tool %s while the debugger is open', async (tool) => {
    openDebugSession()

    const result = await executeTool(store, tool, readInputFor(tool))

    expect(result.success).toBe(true)
  })

  it('should run a write tool again once the debug session is closed', async () => {
    openDebugSession()
    store.getState().workspaceActions.clearDebugState()

    const result = await executeTool(store, 'create_pou', validInputFor('create_pou'))

    expect(result.success).toBe(true)
  })

  it('should keep running write tools when no debug session was ever opened', async () => {
    const result = await executeTool(store, 'create_pou', validInputFor('create_pou'))

    expect(result.success).toBe(true)
  })
})
