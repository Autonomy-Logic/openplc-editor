import { beforeEach, describe, expect, it } from '@jest/globals'

import { createTestStore } from '../../../store/testing'
import { DEBUG_SESSION_SEAM_GLOBAL, installDebugSessionSeam } from '../debug-session-seam'

describe('debug session seam', () => {
  let store: ReturnType<typeof createTestStore>
  let target: Record<string, unknown>

  beforeEach(() => {
    store = createTestStore()
    target = {}
  })

  it('should expose the global name TC76 greps for', () => {
    expect(DEBUG_SESSION_SEAM_GLOBAL).toBe('__OPENPLC_E2E_DEBUG_SESSION__')
  })

  it('should install itself on the target under that name', () => {
    installDebugSessionSeam(store, target)

    expect(target[DEBUG_SESSION_SEAM_GLOBAL]).toBeDefined()
  })

  it('should return the same seam that was installed', () => {
    const seam = installDebugSessionSeam(store, target)

    expect(target[DEBUG_SESSION_SEAM_GLOBAL]).toBe(seam)
  })

  it('should report a closed session before open is called', () => {
    const seam = installDebugSessionSeam(store, target)

    expect(seam.isOpen()).toBe(false)
    expect(store.getState().workspace.isDebuggerVisible).toBe(false)
  })

  it('should open a debug session without a PLC', () => {
    const seam = installDebugSessionSeam(store, target)

    seam.open()

    expect(seam.isOpen()).toBe(true)
    expect(store.getState().workspace.isDebuggerVisible).toBe(true)
  })

  it('should leave the debug tree empty when it opens a session', () => {
    const seam = installDebugSessionSeam(store, target)

    seam.open()

    expect(store.getState().workspace.debugVariableTree.size).toBe(0)
    expect(store.getState().workspace.debugVariableIndexes.size).toBe(0)
    expect(store.getState().workspace.debuggerTargetIp).toBeNull()
  })

  it('should publish the variables an e2e run hands it, with their debug indexes', () => {
    const seam = installDebugSessionSeam(store, target)

    seam.open()
    seam.publishVariables(
      [{ name: 'a', fullPath: 'main.a', compositeKey: 'main:a', type: 'BOOL', isComplex: false, debugIndex: 0 }],
      { 'main:a': 0 },
    )

    const { debugVariableTree, debugVariableIndexes } = store.getState().workspace
    expect(debugVariableTree.get('main:a')?.type).toBe('BOOL')
    expect(debugVariableIndexes.get('main:a')).toBe(0)
  })

  it('should replace the published variables on every call', () => {
    const seam = installDebugSessionSeam(store, target)

    seam.publishVariables([{ name: 'a', fullPath: 'main.a', compositeKey: 'main:a', type: 'BOOL', isComplex: false }])
    seam.publishVariables([{ name: 'b', fullPath: 'main.b', compositeKey: 'main:b', type: 'INT', isComplex: false }])

    const { debugVariableTree } = store.getState().workspace
    expect(Array.from(debugVariableTree.keys())).toEqual(['main:b'])
  })

  it('should drop the published variables when the session closes', () => {
    const seam = installDebugSessionSeam(store, target)

    seam.open()
    seam.publishVariables([{ name: 'a', fullPath: 'main.a', compositeKey: 'main:a', type: 'BOOL', isComplex: false }])
    seam.close()

    expect(store.getState().workspace.debugVariableTree.size).toBe(0)
    expect(store.getState().workspace.debugVariableIndexes.size).toBe(0)
  })

  it('should close the session through the product teardown', () => {
    const seam = installDebugSessionSeam(store, target)

    seam.open()
    seam.close()

    expect(seam.isOpen()).toBe(false)
    expect(store.getState().workspace.isDebuggerVisible).toBe(false)
  })

  it('should be idempotent on open and on close', () => {
    const seam = installDebugSessionSeam(store, target)

    seam.open()
    seam.open()
    expect(store.getState().workspace.isDebuggerVisible).toBe(true)

    seam.close()
    seam.close()
    expect(store.getState().workspace.isDebuggerVisible).toBe(false)
  })

  it('should not change the open project', () => {
    const seam = installDebugSessionSeam(store, target)
    const before = JSON.stringify(store.getState().project)

    seam.open()
    seam.close()

    expect(JSON.stringify(store.getState().project)).toBe(before)
  })
})
