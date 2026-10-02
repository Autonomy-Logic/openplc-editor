/**
 * Project-only accelerators on the start screen. The native menu disables them there, and the
 * handler ignores any that still arrive, so nothing fired with no project open touches the store
 * or the platform.
 */

import { act, render } from '@testing-library/react'
import type { ReactNode } from 'react'

import type { AcceleratorPort } from '../../../../middleware/shared/ports/accelerator-port'
import { EDITOR_CAPABILITIES } from '../../../../middleware/shared/ports/platform-capabilities'
import { PlatformProvider } from '../../../../middleware/shared/providers'
import type { PlatformPorts } from '../../../../middleware/shared/providers/types'
import { openPLCStoreBase } from '../../../store'
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

function Wrapper({ children }: { children: ReactNode }) {
  return <PlatformProvider ports={makePorts()}>{children}</PlatformProvider>
}

function fire(event: ProjectOnlyEvent) {
  const callback = listeners.get(event)
  if (!callback) throw new Error(`nothing subscribed to ${event}`)
  act(() => callback())
}

function openModals(): string[] {
  return Object.entries(openPLCStoreBase.getState().modals)
    .filter(([, modal]) => modal?.open)
    .map(([name]) => name)
}

const initialState = openPLCStoreBase.getState()

beforeEach(() => {
  openPLCStoreBase.setState(initialState, true)
  listeners.clear()
  portCalls.length = 0
})

describe('on the start screen', () => {
  it.each(PROJECT_ONLY)('%s does nothing', (event) => {
    act(() => {
      openPLCStoreBase.getState().workspaceActions.setSelectedProjectTreeLeaf({ label: 'main', type: 'program' })
    })
    render(<AcceleratorHandler />, { wrapper: Wrapper })
    const before = openPLCStoreBase.getState().workspace

    fire(event)

    const after = openPLCStoreBase.getState().workspace
    expect(after.editingState).toBe(before.editingState)
    expect(after.isModalOpen).toEqual([])
    expect(after.isCollapsed).toBe(false)
    expect(openModals()).toEqual([])
    expect(portCalls).toEqual([])
    expect(openPLCStoreBase.getState().project.meta.path).toBe('')
  })
})

describe('with a project open', () => {
  beforeEach(() => {
    act(() => openPLCStoreBase.getState().projectActions.updateMetaPath('/projects/demo'))
  })

  it('Find in Project opens its modal', () => {
    render(<AcceleratorHandler />, { wrapper: Wrapper })

    fire('onFindInProject')

    expect(openPLCStoreBase.getState().workspace.isModalOpen).toEqual([
      { modalName: 'findInProject', modalState: true },
    ])
  })

  it('Switch Perspective toggles the layout', () => {
    render(<AcceleratorHandler />, { wrapper: Wrapper })

    fire('onSwitchPerspective')

    expect(openPLCStoreBase.getState().workspace.isCollapsed).toBe(true)
  })

  it('Page Setup opens its modal', () => {
    render(<AcceleratorHandler />, { wrapper: Wrapper })

    fire('onPageSetup')

    expect(openModals()).toEqual(['page-setup'])
  })
})
