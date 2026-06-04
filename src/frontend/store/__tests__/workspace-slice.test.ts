import { enableMapSet } from 'immer'
import { createStore } from 'zustand/vanilla'

import type { DebugTreeNode, FbInstanceInfo, RuntimeLogEntry } from '../../../middleware/shared/ports/types'
import { LOG_BUFFER_CAP } from '../../../middleware/shared/ports/types'
import { createWorkspaceSlice } from '../slices/workspace/slice'
import type { WorkspaceSlice } from '../slices/workspace/types'

enableMapSet()

function makeStore() {
  return createStore<WorkspaceSlice>()(createWorkspaceSlice)
}

describe('createWorkspaceSlice', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => {
    store = makeStore()
  })

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------
  it('should have correct initial state', () => {
    const { workspace } = store.getState()
    expect(workspace.editingState).toBe('initial-state')
    expect(workspace.systemConfigs).toEqual({
      OS: '',
      arch: '',
      shouldUseDarkMode: false,
      isWindowMaximized: false,
    })
    expect(workspace.recent).toEqual([])
    expect(workspace.isCollapsed).toBe(false)
    expect(workspace.isModalOpen).toEqual([])
    expect(workspace.discardChanges).toBe(false)
    expect(workspace.selectedProjectTreeLeaf).toEqual({ label: '', type: null })
    expect(workspace.close).toEqual({ window: false, app: false, appDarwin: false })
    expect(workspace.isPlcLogsVisible).toBe(false)
    expect(workspace.plcLogs).toBe('')
    expect(workspace.plcLogsLastId).toBeNull()
    expect(workspace.plcFilters).toEqual({
      levels: { debug: true, info: true, warning: true, error: true },
      searchTerm: '',
      timestampFormat: 'full',
    })
    expect(workspace.isDebuggerVisible).toBe(false)
    expect(workspace.debuggerTargetIp).toBeNull()
    expect(workspace.debugCContent).toBeNull()
    expect(workspace.debugVariableIndexes).toEqual(new Map())
    expect(workspace.debugBoolValues).toEqual(new Map())
    expect(workspace.debugNonBoolValues).toEqual(new Map())
    expect(workspace.debugForcedVariables).toEqual(new Map())
    expect(workspace.debugTick).toBe(0)
    expect(workspace.debugVariableTree).toEqual(new Map())
    expect(workspace.debugExpandedNodes).toEqual(new Map())
    expect(workspace.fbDebugInstances).toEqual(new Map())
    expect(workspace.fbSelectedInstance).toEqual(new Map())
    expect(workspace.debugLocalMd5).toBeNull()
    expect(workspace.debugGraphList).toEqual([])
    expect(workspace.debugDataStale).toBe(false)
    expect(workspace.debugMd5Mismatch).toBeNull()
    expect(workspace.debugConnectionType).toBeNull()
  })

  // -------------------------------------------------------------------------
  // Simple setter actions
  // -------------------------------------------------------------------------
  it('setEditingState', () => {
    store.getState().workspaceActions.setEditingState('unsaved')
    expect(store.getState().workspace.editingState).toBe('unsaved')

    store.getState().workspaceActions.setEditingState('saved')
    expect(store.getState().workspace.editingState).toBe('saved')

    store.getState().workspaceActions.setEditingState('save-request')
    expect(store.getState().workspace.editingState).toBe('save-request')
  })

  it('setSystemConfigs', () => {
    const configs = { OS: 'darwin' as const, arch: 'x64' as const, shouldUseDarkMode: true, isWindowMaximized: true }
    store.getState().workspaceActions.setSystemConfigs(configs)
    expect(store.getState().workspace.systemConfigs).toEqual(configs)
  })

  it('setRecent', () => {
    const recent = [{ lastOpenedAt: '2024-01-01', createdAt: '2024-01-01', path: '/test', name: 'Test' }]
    store.getState().workspaceActions.setRecent(recent)
    expect(store.getState().workspace.recent).toEqual(recent)
  })

  it('setCloseApp', () => {
    store.getState().workspaceActions.setCloseApp(true)
    expect(store.getState().workspace.close.app).toBe(true)
  })

  it('setCloseAppDarwin', () => {
    store.getState().workspaceActions.setCloseAppDarwin(true)
    expect(store.getState().workspace.close.appDarwin).toBe(true)
  })

  it('setCloseWindow', () => {
    store.getState().workspaceActions.setCloseWindow(true)
    expect(store.getState().workspace.close.window).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Toggle actions
  // -------------------------------------------------------------------------
  it('switchAppTheme toggles shouldUseDarkMode', () => {
    expect(store.getState().workspace.systemConfigs.shouldUseDarkMode).toBe(false)
    store.getState().workspaceActions.switchAppTheme()
    expect(store.getState().workspace.systemConfigs.shouldUseDarkMode).toBe(true)
    store.getState().workspaceActions.switchAppTheme()
    expect(store.getState().workspace.systemConfigs.shouldUseDarkMode).toBe(false)
  })

  it('toggleMaximizedWindow toggles isWindowMaximized', () => {
    expect(store.getState().workspace.systemConfigs.isWindowMaximized).toBe(false)
    store.getState().workspaceActions.toggleMaximizedWindow()
    expect(store.getState().workspace.systemConfigs.isWindowMaximized).toBe(true)
    store.getState().workspaceActions.toggleMaximizedWindow()
    expect(store.getState().workspace.systemConfigs.isWindowMaximized).toBe(false)
  })

  it('toggleCollapse toggles isCollapsed', () => {
    expect(store.getState().workspace.isCollapsed).toBe(false)
    store.getState().workspaceActions.toggleCollapse()
    expect(store.getState().workspace.isCollapsed).toBe(true)
    store.getState().workspaceActions.toggleCollapse()
    expect(store.getState().workspace.isCollapsed).toBe(false)
  })

  it('toggleDiscardChanges toggles discardChanges', () => {
    expect(store.getState().workspace.discardChanges).toBe(false)
    store.getState().workspaceActions.toggleDiscardChanges()
    expect(store.getState().workspace.discardChanges).toBe(true)
    store.getState().workspaceActions.toggleDiscardChanges()
    expect(store.getState().workspace.discardChanges).toBe(false)
  })

  // -------------------------------------------------------------------------
  // setModalOpen
  // -------------------------------------------------------------------------
  it('setModalOpen adds a new modal entry when not found', () => {
    store.getState().workspaceActions.setModalOpen('my-modal', true)
    expect(store.getState().workspace.isModalOpen).toEqual([{ modalName: 'my-modal', modalState: true }])
  })

  it('setModalOpen updates an existing modal entry', () => {
    store.getState().workspaceActions.setModalOpen('my-modal', true)
    store.getState().workspaceActions.setModalOpen('my-modal', false)
    expect(store.getState().workspace.isModalOpen).toEqual([{ modalName: 'my-modal', modalState: false }])
  })

  // -------------------------------------------------------------------------
  // setSelectedProjectTreeLeaf
  // -------------------------------------------------------------------------
  it('setSelectedProjectTreeLeaf', () => {
    const leaf = { label: 'Main', type: 'program' as const }
    store.getState().workspaceActions.setSelectedProjectTreeLeaf(leaf)
    expect(store.getState().workspace.selectedProjectTreeLeaf).toEqual(leaf)
  })

  // -------------------------------------------------------------------------
  // PLC Logs
  // -------------------------------------------------------------------------
  it('setPlcLogsVisible', () => {
    store.getState().workspaceActions.setPlcLogsVisible(true)
    expect(store.getState().workspace.isPlcLogsVisible).toBe(true)
  })

  it('setPlcLogs with string', () => {
    store.getState().workspaceActions.setPlcLogs('hello logs')
    expect(store.getState().workspace.plcLogs).toBe('hello logs')
  })

  it('setPlcLogs with v4 array', () => {
    const entries: RuntimeLogEntry[] = [{ id: 1, timestamp: '2024-01-01', level: 'INFO', message: 'test' }]
    store.getState().workspaceActions.setPlcLogs(entries)
    expect(store.getState().workspace.plcLogs).toEqual(entries)
  })

  it('setPlcLogsLastId', () => {
    store.getState().workspaceActions.setPlcLogsLastId(42)
    expect(store.getState().workspace.plcLogsLastId).toBe(42)

    store.getState().workspaceActions.setPlcLogsLastId(null)
    expect(store.getState().workspace.plcLogsLastId).toBeNull()
  })

  describe('appendPlcLogs', () => {
    it('appends v4 logs to existing v4 logs', () => {
      const initial: RuntimeLogEntry[] = [{ id: 1, timestamp: 't1', level: 'INFO', message: 'a' }]
      const appended: RuntimeLogEntry[] = [{ id: 2, timestamp: 't2', level: 'DEBUG', message: 'b' }]
      store.getState().workspaceActions.setPlcLogs(initial)
      store.getState().workspaceActions.appendPlcLogs(appended)
      expect(store.getState().workspace.plcLogs).toEqual([...initial, ...appended])
    })

    it('caps v4 logs at LOG_BUFFER_CAP', () => {
      const initial: RuntimeLogEntry[] = Array.from({ length: LOG_BUFFER_CAP }, (_, i) => ({
        id: i,
        timestamp: `t${i}`,
        level: 'INFO' as const,
        message: `msg${i}`,
      }))
      store.getState().workspaceActions.setPlcLogs(initial)
      const extra: RuntimeLogEntry[] = [{ id: LOG_BUFFER_CAP, timestamp: 'tx', level: 'ERROR', message: 'extra' }]
      store.getState().workspaceActions.appendPlcLogs(extra)
      const logs = store.getState().workspace.plcLogs as RuntimeLogEntry[]
      expect(logs.length).toBe(LOG_BUFFER_CAP)
      expect(logs[logs.length - 1].message).toBe('extra')
    })

    it('does not slice v4 logs when combined length is within cap', () => {
      const initial: RuntimeLogEntry[] = [{ id: 1, timestamp: 't1', level: 'INFO', message: 'a' }]
      const appended: RuntimeLogEntry[] = [{ id: 2, timestamp: 't2', level: 'INFO', message: 'b' }]
      store.getState().workspaceActions.setPlcLogs(initial)
      store.getState().workspaceActions.appendPlcLogs(appended)
      expect((store.getState().workspace.plcLogs as RuntimeLogEntry[]).length).toBe(2)
    })

    it('appends string logs to existing string logs', () => {
      store.getState().workspaceActions.setPlcLogs('hello ')
      store.getState().workspaceActions.appendPlcLogs('world')
      expect(store.getState().workspace.plcLogs).toBe('hello world')
    })

    it('replaces logs when types are mismatched (string + v4)', () => {
      store.getState().workspaceActions.setPlcLogs('string logs')
      const v4Logs: RuntimeLogEntry[] = [{ id: 1, timestamp: 't1', level: 'INFO', message: 'a' }]
      store.getState().workspaceActions.appendPlcLogs(v4Logs)
      expect(store.getState().workspace.plcLogs).toEqual(v4Logs)
    })

    it('replaces logs when types are mismatched (v4 + string)', () => {
      const v4Logs: RuntimeLogEntry[] = [{ id: 1, timestamp: 't1', level: 'INFO', message: 'a' }]
      store.getState().workspaceActions.setPlcLogs(v4Logs)
      store.getState().workspaceActions.appendPlcLogs('string logs')
      expect(store.getState().workspace.plcLogs).toBe('string logs')
    })
  })

  it('clearPlcLogs', () => {
    store.getState().workspaceActions.setPlcLogs('some logs')
    store.getState().workspaceActions.setPlcLogsLastId(10)
    store.getState().workspaceActions.clearPlcLogs()
    expect(store.getState().workspace.plcLogs).toBe('')
    expect(store.getState().workspace.plcLogsLastId).toBeNull()
  })

  it('setPlcLevelFilter', () => {
    store.getState().workspaceActions.setPlcLevelFilter('debug', false)
    expect(store.getState().workspace.plcFilters.levels.debug).toBe(false)

    store.getState().workspaceActions.setPlcLevelFilter('error', false)
    expect(store.getState().workspace.plcFilters.levels.error).toBe(false)

    store.getState().workspaceActions.setPlcLevelFilter('info', false)
    expect(store.getState().workspace.plcFilters.levels.info).toBe(false)

    store.getState().workspaceActions.setPlcLevelFilter('warning', false)
    expect(store.getState().workspace.plcFilters.levels.warning).toBe(false)
  })

  it('setPlcSearchTerm', () => {
    store.getState().workspaceActions.setPlcSearchTerm('error')
    expect(store.getState().workspace.plcFilters.searchTerm).toBe('error')
  })

  it('setPlcTimestampFormat', () => {
    store.getState().workspaceActions.setPlcTimestampFormat('time')
    expect(store.getState().workspace.plcFilters.timestampFormat).toBe('time')

    store.getState().workspaceActions.setPlcTimestampFormat('none')
    expect(store.getState().workspace.plcFilters.timestampFormat).toBe('none')
  })

  // -------------------------------------------------------------------------
  // Debug actions
  // -------------------------------------------------------------------------
  it('setDebuggerVisible', () => {
    store.getState().workspaceActions.setDebuggerVisible(true)
    expect(store.getState().workspace.isDebuggerVisible).toBe(true)
  })

  it('setDebuggerTargetIp', () => {
    store.getState().workspaceActions.setDebuggerTargetIp('192.168.0.1')
    expect(store.getState().workspace.debuggerTargetIp).toBe('192.168.0.1')

    store.getState().workspaceActions.setDebuggerTargetIp(null)
    expect(store.getState().workspace.debuggerTargetIp).toBeNull()
  })

  it('setDebugCContent', () => {
    store.getState().workspaceActions.setDebugCContent('some C code')
    expect(store.getState().workspace.debugCContent).toBe('some C code')

    store.getState().workspaceActions.setDebugCContent(null)
    expect(store.getState().workspace.debugCContent).toBeNull()
  })

  it('setDebugVariableIndexes', () => {
    const indexes = new Map([
      ['var1', 0],
      ['var2', 1],
    ])
    store.getState().workspaceActions.setDebugVariableIndexes(indexes)
    expect(store.getState().workspace.debugVariableIndexes).toEqual(indexes)
  })

  it('setDebugBoolValues merges values into existing map', () => {
    const initial = new Map([['var1', 'TRUE']])
    store.getState().workspaceActions.setDebugBoolValues(initial)
    expect(store.getState().workspace.debugBoolValues.get('var1')).toBe('TRUE')

    const update = new Map([['var2', 'FALSE']])
    store.getState().workspaceActions.setDebugBoolValues(update)
    expect(store.getState().workspace.debugBoolValues.get('var1')).toBe('TRUE')
    expect(store.getState().workspace.debugBoolValues.get('var2')).toBe('FALSE')
  })

  it('setDebugNonBoolValues merges values into existing map', () => {
    const initial = new Map([['var1', '42']])
    store.getState().workspaceActions.setDebugNonBoolValues(initial)
    expect(store.getState().workspace.debugNonBoolValues.get('var1')).toBe('42')

    const update = new Map([['var2', '3.14']])
    store.getState().workspaceActions.setDebugNonBoolValues(update)
    expect(store.getState().workspace.debugNonBoolValues.get('var1')).toBe('42')
    expect(store.getState().workspace.debugNonBoolValues.get('var2')).toBe('3.14')
  })

  it('setDebugForcedVariables', () => {
    const forced = new Map([['var1', true]])
    store.getState().workspaceActions.setDebugForcedVariables(forced)
    expect(store.getState().workspace.debugForcedVariables).toEqual(forced)
  })

  it('setDebugTick', () => {
    store.getState().workspaceActions.setDebugTick(42)
    expect(store.getState().workspace.debugTick).toBe(42)
  })

  it('setDebugVariableTree', () => {
    const node: DebugTreeNode = {
      name: 'var1',
      fullPath: 'PROGRAM0.var1',
      compositeKey: 'PROGRAM0::var1',
      type: 'BOOL',
      isComplex: false,
    }
    const tree = new Map([['var1', node]])
    store.getState().workspaceActions.setDebugVariableTree(tree)
    expect(store.getState().workspace.debugVariableTree).toEqual(tree)
  })

  it('setDebugExpandedNodes', () => {
    const expandedNodes = new Map([
      ['node1', true],
      ['node2', false],
    ])
    store.getState().workspaceActions.setDebugExpandedNodes(expandedNodes)
    expect(store.getState().workspace.debugExpandedNodes).toEqual(expandedNodes)
  })

  it('toggleDebugExpandedNode toggles an existing node', () => {
    const expandedNodes = new Map([['node1', true]])
    store.getState().workspaceActions.setDebugExpandedNodes(expandedNodes)
    store.getState().workspaceActions.toggleDebugExpandedNode('node1')
    expect(store.getState().workspace.debugExpandedNodes.get('node1')).toBe(false)
  })

  it('toggleDebugExpandedNode defaults to false for a missing node and toggles to true', () => {
    store.getState().workspaceActions.toggleDebugExpandedNode('missing-node')
    expect(store.getState().workspace.debugExpandedNodes.get('missing-node')).toBe(true)
  })

  it('setFbDebugInstances', () => {
    const info: FbInstanceInfo = {
      fbTypeName: 'TON',
      programName: 'PROGRAM0',
      programInstanceName: 'inst0',
      fbVariableName: 'timer1',
      key: 'PROGRAM0::timer1',
    }
    const instances = new Map([['TON', [info]]])
    store.getState().workspaceActions.setFbDebugInstances(instances)
    expect(store.getState().workspace.fbDebugInstances).toEqual(instances)
  })

  it('setFbSelectedInstance', () => {
    store.getState().workspaceActions.setFbSelectedInstance('TON', 'PROGRAM0::timer1')
    expect(store.getState().workspace.fbSelectedInstance.get('TON')).toBe('PROGRAM0::timer1')
  })

  it('setDebugLocalMd5', () => {
    store.getState().workspaceActions.setDebugLocalMd5('abc123')
    expect(store.getState().workspace.debugLocalMd5).toBe('abc123')

    store.getState().workspaceActions.setDebugLocalMd5(null)
    expect(store.getState().workspace.debugLocalMd5).toBeNull()
  })

  it('setDebugGraphList', () => {
    store.getState().workspaceActions.setDebugGraphList(['var1', 'var2'])
    expect(store.getState().workspace.debugGraphList).toEqual(['var1', 'var2'])
  })

  it('setDebugDataStale', () => {
    store.getState().workspaceActions.setDebugDataStale(true)
    expect(store.getState().workspace.debugDataStale).toBe(true)
  })

  it('setDebugMd5Mismatch', () => {
    const mismatch = { runtimeMd5: 'abc', localMd5: 'def' }
    store.getState().workspaceActions.setDebugMd5Mismatch(mismatch)
    expect(store.getState().workspace.debugMd5Mismatch).toEqual(mismatch)

    store.getState().workspaceActions.setDebugMd5Mismatch(null)
    expect(store.getState().workspace.debugMd5Mismatch).toBeNull()
  })

  it('setDebugConnectionType', () => {
    expect(store.getState().workspace.debugConnectionType).toBeNull()

    store.getState().workspaceActions.setDebugConnectionType('websocket')
    expect(store.getState().workspace.debugConnectionType).toBe('websocket')

    store.getState().workspaceActions.setDebugConnectionType('rtu')
    expect(store.getState().workspace.debugConnectionType).toBe('rtu')

    store.getState().workspaceActions.setDebugConnectionType(null)
    expect(store.getState().workspace.debugConnectionType).toBeNull()
  })

  // -------------------------------------------------------------------------
  // clearDebugState
  // -------------------------------------------------------------------------
  it('clearDebugState resets all debug fields', () => {
    store.getState().workspaceActions.setDebuggerVisible(true)
    store.getState().workspaceActions.setDebuggerTargetIp('192.168.0.1')
    store.getState().workspaceActions.setDebugCContent('code')
    store.getState().workspaceActions.setDebugVariableIndexes(new Map([['x', 1]]))
    store.getState().workspaceActions.setDebugBoolValues(new Map([['x', 'true']]))
    store.getState().workspaceActions.setDebugForcedVariables(new Map([['x', true]]))
    store.getState().workspaceActions.setDebugTick(100)
    store
      .getState()
      .workspaceActions.setDebugVariableTree(
        new Map([['x', { name: 'x', fullPath: 'x', compositeKey: 'x', type: 'BOOL', isComplex: false }]]),
      )
    store.getState().workspaceActions.setDebugExpandedNodes(new Map([['n', true]]))
    store.getState().workspaceActions.setFbDebugInstances(
      new Map([
        [
          'FB',
          [
            {
              fbTypeName: 'FB',
              programName: 'P',
              programInstanceName: 'I',
              fbVariableName: 'V',
              key: 'K',
            },
          ],
        ],
      ]),
    )
    store.getState().workspaceActions.setFbSelectedInstance('FB', 'K')
    store.getState().workspaceActions.setDebugLocalMd5('md5')
    store.getState().workspaceActions.setDebugGraphList(['a'])
    store.getState().workspaceActions.setDebugDataStale(true)
    store.getState().workspaceActions.setDebugMd5Mismatch({ runtimeMd5: 'r', localMd5: 'l' })
    store.getState().workspaceActions.setDebugConnectionType('websocket')

    store.getState().workspaceActions.clearDebugState()

    const { workspace } = store.getState()
    expect(workspace.isDebuggerVisible).toBe(false)
    expect(workspace.debuggerTargetIp).toBeNull()
    expect(workspace.debugCContent).toBeNull()
    expect(workspace.debugVariableIndexes.size).toBe(0)
    expect(workspace.debugBoolValues.size).toBe(0)
    expect(workspace.debugNonBoolValues.size).toBe(0)
    expect(workspace.debugForcedVariables.size).toBe(0)
    expect(workspace.debugTick).toBe(0)
    expect(workspace.debugVariableTree.size).toBe(0)
    expect(workspace.debugExpandedNodes.size).toBe(0)
    expect(workspace.fbDebugInstances.size).toBe(0)
    expect(workspace.fbSelectedInstance.size).toBe(0)
    expect(workspace.debugLocalMd5).toBeNull()
    expect(workspace.debugGraphList).toEqual([])
    expect(workspace.debugDataStale).toBe(false)
    expect(workspace.debugMd5Mismatch).toBeNull()
    expect(workspace.debugConnectionType).toBeNull()
  })

  // -------------------------------------------------------------------------
  // clearFbDebugContext
  // -------------------------------------------------------------------------
  it('clearFbDebugContext resets only FB-related maps', () => {
    store.getState().workspaceActions.setFbDebugInstances(
      new Map([
        [
          'FB',
          [
            {
              fbTypeName: 'FB',
              programName: 'P',
              programInstanceName: 'I',
              fbVariableName: 'V',
              key: 'K',
            },
          ],
        ],
      ]),
    )
    store.getState().workspaceActions.setFbSelectedInstance('FB', 'K')

    store.getState().workspaceActions.clearFbDebugContext()
    expect(store.getState().workspace.fbDebugInstances.size).toBe(0)
    expect(store.getState().workspace.fbSelectedInstance.size).toBe(0)
  })

  // -------------------------------------------------------------------------
  // removeDebugVariable
  // -------------------------------------------------------------------------
  it('removeDebugVariable removes from all relevant maps', () => {
    const key = 'PROGRAM0::myVar'
    store.getState().workspaceActions.setDebugVariableIndexes(new Map([[key, 5]]))
    store.getState().workspaceActions.setDebugNonBoolValues(new Map([[key, '42']]))
    store.getState().workspaceActions.setDebugForcedVariables(new Map([[key, true]]))
    store
      .getState()
      .workspaceActions.setDebugVariableTree(
        new Map([[key, { name: 'myVar', fullPath: key, compositeKey: key, type: 'INT', isComplex: false }]]),
      )
    store.getState().workspaceActions.setDebugExpandedNodes(new Map([[key, true]]))

    store.getState().workspaceActions.removeDebugVariable(key)

    const { workspace } = store.getState()
    expect(workspace.debugVariableIndexes.has(key)).toBe(false)
    expect(workspace.debugBoolValues.has(key)).toBe(false)
    expect(workspace.debugNonBoolValues.has(key)).toBe(false)
    expect(workspace.debugForcedVariables.has(key)).toBe(false)
    expect(workspace.debugVariableTree.has(key)).toBe(false)
    expect(workspace.debugExpandedNodes.has(key)).toBe(false)
  })

  // -------------------------------------------------------------------------
  // clearWorkspace
  // -------------------------------------------------------------------------
  it('clearWorkspace resets workspace fields including debug and logs', () => {
    store.getState().workspaceActions.setEditingState('unsaved')
    store.getState().workspaceActions.setSelectedProjectTreeLeaf({ label: 'Main', type: 'program' })
    store.getState().workspaceActions.setDebuggerVisible(true)
    store.getState().workspaceActions.setDebuggerTargetIp('10.0.0.1')
    store.getState().workspaceActions.setDebugCContent('code')
    store.getState().workspaceActions.setDebugTick(99)
    store.getState().workspaceActions.setDebugLocalMd5('md5')
    store.getState().workspaceActions.setDebugGraphList(['g'])
    store.getState().workspaceActions.setDebugDataStale(true)
    store.getState().workspaceActions.setDebugMd5Mismatch({ runtimeMd5: 'a', localMd5: 'b' })
    store.getState().workspaceActions.setPlcLogsVisible(true)
    store.getState().workspaceActions.setPlcLogs('logs')
    store.getState().workspaceActions.setPlcLogsLastId(5)

    store.getState().workspaceActions.setProjectLoading(true, 'Loading project...')
    store.getState().workspaceActions.setCanEdit(false)

    expect(store.getState().workspace.isProjectLoading).toBe(true)
    expect(store.getState().workspace.projectLoadingMessage).toBe('Loading project...')
    expect(store.getState().workspace.canEdit).toBe(false)

    store.getState().workspaceActions.setProjectLoading(false)
    store.getState().workspaceActions.setCanEdit(true)

    expect(store.getState().workspace.isProjectLoading).toBe(false)
    expect(store.getState().workspace.projectLoadingMessage).toBe('')
    expect(store.getState().workspace.canEdit).toBe(true)

    // setCanEdit(false) again so clearWorkspace's reset path is exercised
    // — keeps the assertion below honest about the reset back to `true`.
    store.getState().workspaceActions.setCanEdit(false)

    store.getState().workspaceActions.clearWorkspace()

    const { workspace } = store.getState()
    expect(workspace.editingState).toBe('initial-state')
    expect(workspace.selectedProjectTreeLeaf).toEqual({ label: '', type: null })
    expect(workspace.isDebuggerVisible).toBe(false)
    expect(workspace.debuggerTargetIp).toBeNull()
    expect(workspace.debugCContent).toBeNull()
    expect(workspace.debugVariableIndexes.size).toBe(0)
    expect(workspace.debugBoolValues.size).toBe(0)
    expect(workspace.debugNonBoolValues.size).toBe(0)
    expect(workspace.debugForcedVariables.size).toBe(0)
    expect(workspace.debugTick).toBe(0)
    expect(workspace.debugVariableTree.size).toBe(0)
    expect(workspace.debugExpandedNodes.size).toBe(0)
    expect(workspace.fbDebugInstances.size).toBe(0)
    expect(workspace.fbSelectedInstance.size).toBe(0)
    expect(workspace.debugLocalMd5).toBeNull()
    expect(workspace.debugGraphList).toEqual([])
    expect(workspace.debugDataStale).toBe(false)
    expect(workspace.debugMd5Mismatch).toBeNull()
    expect(workspace.debugConnectionType).toBeNull()
    expect(workspace.isPlcLogsVisible).toBe(false)
    expect(workspace.plcLogs).toBe('')
    expect(workspace.plcLogsLastId).toBeNull()
    expect(workspace.plcFilters).toEqual({
      levels: { debug: true, info: true, warning: true, error: true },
      searchTerm: '',
      timestampFormat: 'full',
    })
    expect(workspace.canEdit).toBe(true)
  })
})
