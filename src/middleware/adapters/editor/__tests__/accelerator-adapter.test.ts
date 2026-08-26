import type { AcceleratorPort } from '../../../shared/ports/accelerator-port'
import { createEditorAcceleratorAdapter } from '../accelerator-adapter'

let adapter: AcceleratorPort

/**
 * Each bridge method captures its callback so tests can invoke it manually.
 * A captured handler going back to `null` stands in for the real bridge
 * dropping the IPC listener — the adapter must return the bridge's disposer
 * verbatim for that to happen.
 */
const capturedHandlers: Record<string, ((...args: unknown[]) => void) | null> = {}

/** Invokes a captured bridge listener, failing loudly if none was registered.
 *  CLAUDE.md forbids non-null assertions, and a bare `?.()` would let a missing
 *  registration pass the test silently. */
const fire = (key: string, ...args: unknown[]): void => {
  const handler = capturedHandlers[key]
  if (!handler) throw new Error(`no listener captured for "${key}"`)
  handler(...args)
}

/** Emits on a channel whose listener may already be gone — used after an
 *  unsubscribe to show the callback stays silent. */
const fireIfRegistered = (key: string, ...args: unknown[]): void => {
  capturedHandlers[key]?.(...args)
}

/** Mirrors the bridge contract: register the listener, return its disposer. */
const register = (key: string) =>
  jest.fn().mockImplementation((cb: (...args: unknown[]) => void) => {
    capturedHandlers[key] = cb
    return () => {
      capturedHandlers[key] = null
    }
  })

beforeEach(() => {
  for (const key of Object.keys(capturedHandlers)) {
    capturedHandlers[key] = null
  }

  window.bridge = {
    createProjectAccelerator: register('createProject'),
    handleOpenProjectRequest: register('openProject'),
    openRecentAccelerator: register('openRecent'),
    saveProjectAccelerator: register('saveProject'),
    saveFileAccelerator: register('saveFile'),
    closeProjectAccelerator: register('closeProject'),
    exportProjectRequest: register('exportProject'),
    closeTabAccelerator: register('closeTab'),
    deleteFileAccelerator: register('deleteFile'),
    findInProjectAccelerator: register('findInProject'),
    handleUndoRequest: register('undo'),
    handleRedoRequest: register('redo'),
    switchPerspective: register('switchPerspective'),
    aboutModalAccelerator: register('about'),
    quitAppRequest: register('quitApp'),
  } as unknown as typeof window.bridge

  adapter = createEditorAcceleratorAdapter()
})

// Helper: exercises the standard pattern shared by most accelerator methods
function testAccelerator(methodName: keyof AcceleratorPort, handlerKey: string, bridgeMethodName: string) {
  describe(methodName, () => {
    it('registers a bridge listener and fires the callback', () => {
      const cb = jest.fn()
      ;(adapter[methodName] as (cb: () => void) => () => void)(cb)

      expect((window.bridge as unknown as Record<string, jest.Mock>)[bridgeMethodName]).toHaveBeenCalledTimes(1)

      fire(handlerKey)
      expect(cb).toHaveBeenCalledTimes(1)
    })

    it('returns an unsubscribe function that deactivates the callback', () => {
      const cb = jest.fn()
      const unsub = (adapter[methodName] as (cb: () => void) => () => void)(cb)

      unsub()
      fireIfRegistered(handlerKey)

      expect(cb).not.toHaveBeenCalled()
    })

    it('removes the underlying bridge listener on unsubscribe', () => {
      const unsub = (adapter[methodName] as (cb: () => void) => () => void)(jest.fn())

      expect(capturedHandlers[handlerKey]).toBeInstanceOf(Function)
      unsub()

      // Not merely flagged inactive — the listener itself is gone, so repeated
      // mount/unmount cycles cannot pile up dead IPC listeners.
      expect(capturedHandlers[handlerKey]).toBeNull()
    })
  })
}

testAccelerator('onCreateProject', 'createProject', 'createProjectAccelerator')
testAccelerator('onOpenProject', 'openProject', 'handleOpenProjectRequest')
testAccelerator('onSaveProject', 'saveProject', 'saveProjectAccelerator')
testAccelerator('onSaveFile', 'saveFile', 'saveFileAccelerator')
testAccelerator('onCloseProject', 'closeProject', 'closeProjectAccelerator')
testAccelerator('onExportProject', 'exportProject', 'exportProjectRequest')
testAccelerator('onCloseTab', 'closeTab', 'closeTabAccelerator')
testAccelerator('onDeleteFile', 'deleteFile', 'deleteFileAccelerator')
testAccelerator('onFindInProject', 'findInProject', 'findInProjectAccelerator')
testAccelerator('onUndo', 'undo', 'handleUndoRequest')
testAccelerator('onRedo', 'redo', 'handleRedoRequest')
testAccelerator('onSwitchPerspective', 'switchPerspective', 'switchPerspective')
testAccelerator('onAbout', 'about', 'aboutModalAccelerator')
testAccelerator('onQuitApp', 'quitApp', 'quitAppRequest')

describe('onOpenRecent', () => {
  it('registers a bridge listener and passes response data to the callback', () => {
    const cb = jest.fn()
    adapter.onOpenRecent(cb)

    expect(window.bridge.openRecentAccelerator).toHaveBeenCalledTimes(1)

    const mockEvent = {}
    const mockResponse = { projectPath: '/some/path' }
    fire('openRecent', mockEvent, mockResponse)

    expect(cb).toHaveBeenCalledWith(mockResponse)
  })

  it('returns an unsubscribe function that deactivates the callback', () => {
    const cb = jest.fn()
    const unsub = adapter.onOpenRecent(cb)

    unsub()
    fireIfRegistered('openRecent', {}, { projectPath: '/x' })

    expect(cb).not.toHaveBeenCalled()
  })

  it('removes the underlying bridge listener on unsubscribe', () => {
    const unsub = adapter.onOpenRecent(jest.fn())

    expect(capturedHandlers.openRecent).toBeInstanceOf(Function)
    unsub()

    expect(capturedHandlers.openRecent).toBeNull()
  })
})
