import type { AcceleratorPort } from '../../../shared/ports/accelerator-port'
import { createEditorAcceleratorAdapter } from '../accelerator-adapter'

let adapter: AcceleratorPort

/**
 * Each bridge method captures its callback so tests can invoke it manually.
 */
const capturedHandlers: Record<string, ((...args: unknown[]) => void) | null> = {}

beforeEach(() => {
  for (const key of Object.keys(capturedHandlers)) {
    capturedHandlers[key] = null
  }

  window.bridge = {
    createProjectAccelerator: jest.fn().mockImplementation((cb: () => void) => {
      capturedHandlers.createProject = cb
    }),
    handleOpenProjectRequest: jest.fn().mockImplementation((cb: () => void) => {
      capturedHandlers.openProject = cb
    }),
    openRecentAccelerator: jest.fn().mockImplementation((cb: (...args: unknown[]) => void) => {
      capturedHandlers.openRecent = cb
    }),
    saveProjectAccelerator: jest.fn().mockImplementation((cb: () => void) => {
      capturedHandlers.saveProject = cb
    }),
    saveFileAccelerator: jest.fn().mockImplementation((cb: () => void) => {
      capturedHandlers.saveFile = cb
    }),
    closeProjectAccelerator: jest.fn().mockImplementation((cb: () => void) => {
      capturedHandlers.closeProject = cb
    }),
    exportProjectRequest: jest.fn().mockImplementation((cb: () => void) => {
      capturedHandlers.exportProject = cb
    }),
    closeTabAccelerator: jest.fn().mockImplementation((cb: () => void) => {
      capturedHandlers.closeTab = cb
    }),
    deleteFileAccelerator: jest.fn().mockImplementation((cb: () => void) => {
      capturedHandlers.deleteFile = cb
    }),
    findInProjectAccelerator: jest.fn().mockImplementation((cb: () => void) => {
      capturedHandlers.findInProject = cb
    }),
    handleUndoRequest: jest.fn().mockImplementation((cb: () => void) => {
      capturedHandlers.undo = cb
    }),
    handleRedoRequest: jest.fn().mockImplementation((cb: () => void) => {
      capturedHandlers.redo = cb
    }),
    switchPerspective: jest.fn().mockImplementation((cb: () => void) => {
      capturedHandlers.switchPerspective = cb
    }),
    aboutModalAccelerator: jest.fn().mockImplementation((cb: () => void) => {
      capturedHandlers.about = cb
    }),
    quitAppRequest: jest.fn().mockImplementation((cb: () => void) => {
      capturedHandlers.quitApp = cb
    }),
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

      capturedHandlers[handlerKey]!()
      expect(cb).toHaveBeenCalledTimes(1)
    })

    it('returns an unsubscribe function that deactivates the callback', () => {
      const cb = jest.fn()
      const unsub = (adapter[methodName] as (cb: () => void) => () => void)(cb)

      unsub()
      capturedHandlers[handlerKey]!()

      expect(cb).not.toHaveBeenCalled()
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
    capturedHandlers.openRecent!(mockEvent, mockResponse)

    expect(cb).toHaveBeenCalledWith(mockResponse)
  })

  it('returns an unsubscribe function that deactivates the callback', () => {
    const cb = jest.fn()
    const unsub = adapter.onOpenRecent(cb)

    unsub()
    capturedHandlers.openRecent!({}, { projectPath: '/x' })

    expect(cb).not.toHaveBeenCalled()
  })
})
