/**
 * Project-only accelerators on the start screen. The native menu disables them there, and the
 * handler ignores any that still arrive, so nothing fired with no project open touches the store
 * or the platform.
 */

import { act, render } from '@testing-library/react'
import type { AcceleratorPort } from '../../../../middleware/shared/ports/accelerator-port'
import { EDITOR_CAPABILITIES } from '../../../../middleware/shared/ports/platform-capabilities'
import type { PlatformPorts } from '../../../../middleware/shared/providers/types'
import type { OpenPLCStore } from '../../../store'
import { createStoreWrapper, createTestStore } from '../../../store/testing'
import { AcceleratorHandler } from '../accelerator-handler'

const PROJECT_ONLY = [
  'onSaveProject',
  'onSaveProjectAs',
  'onCloseProject',
  'onCloseTab',
  'onExportProject',
  'onPrint',
  'onPageSetup',
  'onDeleteFile',
  'onFindInProject',
  'onSwitchPerspective',
  'onUndo',
  'onRedo',
] as const

type ProjectOnlyEvent = (typeof PROJECT_ONLY)[number]

const listeners = new Map<string, () => void>()
const portCalls: string[] = []

/** Records every call so a test can prove the platform was never reached. */
function recordingPort<T extends object>(name: string): T {
  const target: T = Object.create(null)
  return new Proxy(target, {
    get: (_, prop) =>
      typeof prop === 'string'
        ? () => {
            portCalls.push(`${name}.${prop}`)
            return Promise.resolve({ success: false })
          }
        : undefined,
  })
}

function stubPort<T extends object>(): T {
  const target: T = Object.create(null)
  return new Proxy(target, {
    get: (_, prop) => (typeof prop === 'string' ? () => undefined : undefined),
  })
}

const accelerator = new Proxy<AcceleratorPort>(Object.create(null), {
  get: (_, prop) =>
    typeof prop === 'string'
      ? (callback: () => void) => {
          listeners.set(prop, callback)
          return () => {
            if (listeners.get(prop) === callback) listeners.delete(prop)
          }
        }
      : undefined,
})

function makePorts(): PlatformPorts {
  return {
    compiler: recordingPort('compiler'),
    runtime: stubPort(),
    debugger: stubPort(),
    simulator: stubPort(),
    project: recordingPort('project'),
    device: stubPort(),
    orchestrator: stubPort(),
    system: stubPort(),
    window: stubPort(),
    accelerator,
    theme: stubPort(),
    versionControl: stubPort(),
    navigation: stubPort(),
    library: stubPort(),
    capabilities: EDITOR_CAPABILITIES,
  }
}

let store: OpenPLCStore

function renderHandler() {
  return render(<AcceleratorHandler />, { wrapper: createStoreWrapper(store, makePorts()) })
}

function fire(event: ProjectOnlyEvent) {
  const callback = listeners.get(event)
  if (!callback) throw new Error(`nothing subscribed to ${event}`)
  act(() => callback())
}

function openModals(): string[] {
  return Object.entries(store.getState().modals)
    .filter(([, modal]) => modal?.open)
    .map(([name]) => name)
}

beforeEach(() => {
  store = createTestStore()
  listeners.clear()
  portCalls.length = 0
})

describe('on the start screen', () => {
  it.each(PROJECT_ONLY)('%s does nothing', (event) => {
    act(() => {
      store.getState().workspaceActions.setSelectedProjectTreeLeaf({ label: 'main', type: 'program' })
    })
    renderHandler()
    const before = store.getState().workspace

    fire(event)

    const after = store.getState().workspace
    expect(after.editingState).toBe(before.editingState)
    expect(after.isModalOpen).toEqual([])
    expect(after.isCollapsed).toBe(false)
    expect(openModals()).toEqual([])
    expect(portCalls).toEqual([])
    expect(store.getState().project.meta.path).toBe('')
  })
})

describe('with a project open', () => {
  beforeEach(() => {
    act(() => store.getState().projectActions.updateMetaPath('/projects/demo'))
  })

  it('Find in Project opens its modal', () => {
    renderHandler()

    fire('onFindInProject')

    expect(store.getState().workspace.isModalOpen).toEqual([{ modalName: 'findInProject', modalState: true }])
  })

  it('Switch Perspective toggles the layout', () => {
    renderHandler()

    fire('onSwitchPerspective')

    expect(store.getState().workspace.isCollapsed).toBe(true)
  })

  it('Page Setup opens its modal', () => {
    renderHandler()

    fire('onPageSetup')

    expect(openModals()).toEqual(['page-setup'])
  })
})
