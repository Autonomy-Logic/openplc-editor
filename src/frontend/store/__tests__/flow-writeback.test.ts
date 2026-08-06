import { createStore } from 'zustand/vanilla'

import { createAISlice } from '../slices/ai'
import { createConsoleSlice } from '../slices/console/slice'
import { createDeviceSlice } from '../slices/device/slice'
import { createEditorSlice } from '../slices/editor/slice'
import { createFBDFlowSlice } from '../slices/fbd/slice'
import { createFileSlice } from '../slices/file/slice'
import { createHistorySlice } from '../slices/history/slice'
import type { LadderFlowType } from '../slices/ladder'
import { createLadderFlowSlice } from '../slices/ladder/slice'
import { createLibrarySlice } from '../slices/library/slice'
import { createModalSlice } from '../slices/modal/slice'
import { createProjectSlice } from '../slices/project/slice'
import { createSearchSlice } from '../slices/search/slice'
import {
  cancelFlowWriteBacks,
  FLOW_WRITEBACK_DEBOUNCE_MS,
  flushFlowWriteBacks,
  scheduleFlowWriteBack,
} from '../slices/shared/flow-writeback'
import { createSharedSlice } from '../slices/shared/slice'
import type { SharedRootState } from '../slices/shared/types'
import { createTabsSlice } from '../slices/tabs/slice'
import { createVersionControlSlice } from '../slices/version-control/slice'
import { createWorkspaceSlice } from '../slices/workspace/slice'

function makeStore() {
  return createStore<SharedRootState>()((...args) => ({
    ...createProjectSlice(...args),
    ...createFileSlice(...args),
    ...createEditorSlice(...args),
    ...createTabsSlice(...args),
    ...createLibrarySlice(...args),
    ...createWorkspaceSlice(...args),
    ...createModalSlice(...args),
    ...createSearchSlice(...args),
    ...createConsoleSlice(...args),
    ...createDeviceSlice(...args),
    ...createFBDFlowSlice(...args),
    ...createLadderFlowSlice(...args),
    ...createHistorySlice(...args),
    ...createVersionControlSlice(...args),
    ...createAISlice(...args),
    ...createSharedSlice(...args),
  }))
}

describe('flow write-back scheduler', () => {
  let store: ReturnType<typeof makeStore>

  const getState = () => store.getState()

  const ladderBody = (pouName: string) =>
    store.getState().project.data.pous.find((p) => p.name === pouName)?.body.value as LadderFlowType | undefined

  /** Create an LD program and give its flow one (valid) rung, marked updated. */
  const makeDirtyLadderPou = (name: string) => {
    store.getState().pouActions.create({ type: 'program', name, language: 'ld' })
    store.getState().ladderFlowActions.startLadderRung({
      editorName: name,
      rungId: `rung_${name}_1`,
      defaultBounds: [300, 100],
      reactFlowViewport: [300, 100],
    })
    store.getState().ladderFlowActions.setFlowUpdated({ editorName: name, updated: true })
  }

  beforeEach(() => {
    vi.useFakeTimers()
    store = makeStore()
  })

  afterEach(() => {
    cancelFlowWriteBacks()
    vi.useRealTimers()
  })

  describe('scheduleFlowWriteBack', () => {
    it('marks the file dirty immediately but defers the body write-back', () => {
      makeDirtyLadderPou('Main')
      store.getState().fileActions.updateFile({ name: 'Main', saved: true })

      scheduleFlowWriteBack(getState, 'Main', 'ld')

      expect(store.getState().files['Main']?.saved).toBe(false)
      expect(ladderBody('Main')?.rungs).toHaveLength(0)

      vi.advanceTimersByTime(FLOW_WRITEBACK_DEBOUNCE_MS)

      expect(ladderBody('Main')?.rungs).toHaveLength(1)
      expect(store.getState().ladderFlows.find((f) => f.name === 'Main')?.updated).toBe(false)
    })

    it('persists the flow without the transient updated flag, sharing structure with the flow slice', () => {
      makeDirtyLadderPou('Main')

      scheduleFlowWriteBack(getState, 'Main', 'ld')
      vi.advanceTimersByTime(FLOW_WRITEBACK_DEBOUNCE_MS)

      const body = ladderBody('Main')
      const flow = store.getState().ladderFlows.find((f) => f.name === 'Main')
      expect(body && 'updated' in body).toBe(false)
      // By-reference persistence: the project copy and the live flow share
      // the (immutable) rung objects instead of deep-cloning them.
      expect(body?.rungs[0]).toBe(flow?.rungs[0])
    })

    it('does not mark the file dirty while the debugger is visible', () => {
      makeDirtyLadderPou('Main')
      store.getState().fileActions.updateFile({ name: 'Main', saved: true })
      store.getState().workspaceActions.setDebuggerVisible(true)

      scheduleFlowWriteBack(getState, 'Main', 'ld')

      expect(store.getState().files['Main']?.saved).toBe(true)
    })

    it('coalesces edits into a single pending timer (no debounce reset)', () => {
      makeDirtyLadderPou('Main')

      scheduleFlowWriteBack(getState, 'Main', 'ld')
      vi.advanceTimersByTime(FLOW_WRITEBACK_DEBOUNCE_MS / 2)

      // A second edit inside the window re-schedules: the first timer stands.
      store.getState().ladderFlowActions.startLadderRung({
        editorName: 'Main',
        rungId: 'rung_Main_2',
        defaultBounds: [300, 100],
        reactFlowViewport: [300, 100],
      })
      scheduleFlowWriteBack(getState, 'Main', 'ld')

      // Fires DEBOUNCE_MS after the FIRST schedule and picks up both edits.
      vi.advanceTimersByTime(FLOW_WRITEBACK_DEBOUNCE_MS / 2)
      expect(ladderBody('Main')?.rungs).toHaveLength(2)
    })

    it('writes back FBD flows through the same scheduler', () => {
      store.getState().pouActions.create({ type: 'program', name: 'FbdMain', language: 'fbd' })
      store.getState().fbdFlowActions.setFlowUpdated({ editorName: 'FbdMain', updated: true })

      scheduleFlowWriteBack(getState, 'FbdMain', 'fbd')
      vi.advanceTimersByTime(FLOW_WRITEBACK_DEBOUNCE_MS)

      const body = store.getState().project.data.pous.find((p) => p.name === 'FbdMain')?.body.value as
        | { rung?: unknown; updated?: unknown }
        | undefined
      expect(body?.rung).toBeDefined()
      expect(body && 'updated' in body).toBe(false)
      expect(store.getState().fbdFlows.find((f) => f.name === 'FbdMain')?.updated).toBe(false)
    })

    it('skips execution when the flow is gone or no longer marked updated', () => {
      makeDirtyLadderPou('Main')
      scheduleFlowWriteBack(getState, 'Ghost', 'ld')
      scheduleFlowWriteBack(getState, 'Main', 'ld')
      store.getState().ladderFlowActions.setFlowUpdated({ editorName: 'Main', updated: false })

      vi.advanceTimersByTime(FLOW_WRITEBACK_DEBOUNCE_MS)

      expect(ladderBody('Main')?.rungs).toHaveLength(0)
    })

    it('refuses to persist a flow that fails schema validation', () => {
      makeDirtyLadderPou('Main')
      // Replace the flow with a malformed one (rung missing bounds/viewport).
      // addLadderFlow resets `updated` on store, so re-flag it afterwards.
      store.getState().ladderFlowActions.addLadderFlow({
        name: 'Main',
        updated: true,
        rungs: [{ id: 'r1', nodes: [], edges: [] }],
      } as unknown as LadderFlowType)
      store.getState().ladderFlowActions.setFlowUpdated({ editorName: 'Main', updated: true })

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      scheduleFlowWriteBack(getState, 'Main', 'ld')
      vi.advanceTimersByTime(FLOW_WRITEBACK_DEBOUNCE_MS)

      expect(ladderBody('Main')?.rungs).toHaveLength(0)
      expect(store.getState().ladderFlows.find((f) => f.name === 'Main')?.updated).toBe(true)
      warn.mockRestore()
    })
  })

  describe('flushFlowWriteBacks', () => {
    it('runs a pending write-back immediately', () => {
      makeDirtyLadderPou('Main')
      scheduleFlowWriteBack(getState, 'Main', 'ld')

      flushFlowWriteBacks(getState)

      expect(ladderBody('Main')?.rungs).toHaveLength(1)
      // The timer was cancelled along with the flush — nothing fires later.
      const bodyAfterFlush = ladderBody('Main')
      vi.advanceTimersByTime(FLOW_WRITEBACK_DEBOUNCE_MS)
      expect(ladderBody('Main')).toBe(bodyAfterFlush)
    })

    it('scopes the flush to one POU when a name is given', () => {
      makeDirtyLadderPou('A')
      makeDirtyLadderPou('B')
      scheduleFlowWriteBack(getState, 'A', 'ld')
      scheduleFlowWriteBack(getState, 'B', 'ld')

      flushFlowWriteBacks(getState, 'A')

      expect(ladderBody('A')?.rungs).toHaveLength(1)
      expect(ladderBody('B')?.rungs).toHaveLength(0)

      vi.advanceTimersByTime(FLOW_WRITEBACK_DEBOUNCE_MS)
      expect(ladderBody('B')?.rungs).toHaveLength(1)
    })

    it('leaves the other language untouched when scoped to one POU', () => {
      makeDirtyLadderPou('Main')
      store.getState().pouActions.create({ type: 'program', name: 'FbdMain', language: 'fbd' })
      store.getState().fbdFlowActions.startFBDRung({ editorName: 'FbdMain' })
      store.getState().fbdFlowActions.setFlowUpdated({ editorName: 'FbdMain', updated: true })

      expect(flushFlowWriteBacks(getState, 'Main')).toEqual([])
      expect(store.getState().fbdFlows.find((f) => f.name === 'FbdMain')?.updated).toBe(true)
    })

    it('writes back an updated flow that has no pending timer', () => {
      makeDirtyLadderPou('Main')

      expect(flushFlowWriteBacks(getState)).toEqual([])
      expect(ladderBody('Main')?.rungs).toHaveLength(1)
      expect(store.getState().ladderFlows.find((f) => f.name === 'Main')?.updated).toBe(false)
    })

    it('is a no-op when no flow is marked updated', () => {
      makeDirtyLadderPou('Main')
      flushFlowWriteBacks(getState)
      const bodyBefore = ladderBody('Main')

      expect(flushFlowWriteBacks(getState)).toEqual([])
      expect(ladderBody('Main')).toBe(bodyBefore)
    })

    it('reports the POU and leaves the body stale when the flow fails validation', () => {
      makeDirtyLadderPou('Main')
      flushFlowWriteBacks(getState)
      const bodyBefore = ladderBody('Main')

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const flow = store.getState().ladderFlows.find((f) => f.name === 'Main')
      store.getState().ladderFlowActions.setRungs({
        editorName: 'Main',
        // `defaultBounds` is required by the schema — dropping it makes the flow invalid.
        rungs: (flow?.rungs ?? []).map(({ defaultBounds: _defaultBounds, ...rung }) => rung) as never,
      })

      expect(flushFlowWriteBacks(getState)).toEqual(['Main'])
      expect(ladderBody('Main')).toBe(bodyBefore)
      expect(store.getState().ladderFlows.find((f) => f.name === 'Main')?.updated).toBe(true)
      expect(warn).toHaveBeenCalled()
      warn.mockRestore()
    })

    it('reports a failing FBD flow', () => {
      store.getState().pouActions.create({ type: 'program', name: 'FbdMain', language: 'fbd' })
      store.getState().fbdFlowActions.startFBDRung({ editorName: 'FbdMain' })

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      // `nodes` is required by the schema — dropping it makes the flow invalid.
      store.getState().fbdFlowActions.setRung({
        editorName: 'FbdMain',
        rung: { comment: '', edges: [], selectedNodes: [] } as never,
      })

      expect(flushFlowWriteBacks(getState)).toEqual(['FbdMain'])
      expect(warn).toHaveBeenCalled()
      warn.mockRestore()
    })
  })

  describe('cancelFlowWriteBacks', () => {
    it('drops pending write-backs without running them', () => {
      makeDirtyLadderPou('Main')
      scheduleFlowWriteBack(getState, 'Main', 'ld')

      cancelFlowWriteBacks()
      vi.advanceTimersByTime(FLOW_WRITEBACK_DEBOUNCE_MS)

      expect(ladderBody('Main')?.rungs).toHaveLength(0)
      expect(store.getState().ladderFlows.find((f) => f.name === 'Main')?.updated).toBe(true)
    })

    it('scopes the cancel to one POU when a name is given', () => {
      makeDirtyLadderPou('A')
      makeDirtyLadderPou('B')
      scheduleFlowWriteBack(getState, 'A', 'ld')
      scheduleFlowWriteBack(getState, 'B', 'ld')

      cancelFlowWriteBacks('A')
      vi.advanceTimersByTime(FLOW_WRITEBACK_DEBOUNCE_MS)

      expect(ladderBody('A')?.rungs).toHaveLength(0)
      expect(ladderBody('B')?.rungs).toHaveLength(1)
    })
  })
})
