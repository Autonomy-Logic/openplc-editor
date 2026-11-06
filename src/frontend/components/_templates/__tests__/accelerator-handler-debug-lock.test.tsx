/** Editing accelerators while a debug session is open: they must do nothing, quietly. */

import { act, render } from '@testing-library/react'
import type { AcceleratorPort } from '../../../../middleware/shared/ports/accelerator-port'
import { EDITOR_CAPABILITIES } from '../../../../middleware/shared/ports/platform-capabilities'
import type { PlatformPorts } from '../../../../middleware/shared/providers/types'
import type { OpenPLCStore } from '../../../store'
import { CreateEditorModelObject } from '../../../store/slices/tabs/utils'
import { createStoreWrapper, createTestStore } from '../../../store/testing'
import { AcceleratorHandler } from '../accelerator-handler'

const EDITING_ACCELERATORS = ['onUndo', 'onRedo', 'onDeleteFile', 'onImportPLCopenXML'] as const

type EditingEvent = (typeof EDITING_ACCELERATORS)[number]

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

function fire(event: EditingEvent) {
  const callback = listeners.get(event)
  if (!callback) throw new Error(`nothing subscribed to ${event}`)
  act(() => callback())
}



function openModals(): string[] {
  return Object.entries(store.getState().modals)
    .filter(([, modal]) => modal?.open)
    .map(([name]) => name)
}

const toasts = () => Array.from(document.querySelectorAll('[role="status"], [role="alert"]'))

const openDebugSession = () =>
  act(() => {
    store.getState().workspaceActions.setDebuggerVisible(true)
  })

const closeDebugSession = () =>
  act(() => {
    store.getState().workspaceActions.clearDebugState()
  })

/** The variable the POU carries now; the past snapshot holds its earlier name. */
const currentVariableName = () =>
  store.getState().project.data.pous.find((pou) => pou.name === 'aux')?.interface?.variables[0]?.name

beforeEach(() => {
  store = createTestStore()
  listeners.clear()
  portCalls.length = 0
  act(() => {
    store.getState().projectActions.updateMetaPath('/projects/demo')
    expect(store.getState().pouActions.create({ type: 'program', name: 'aux', language: 'st' }).ok).toBe(true)
    expect(
      store.getState().projectActions.createVariable({
        scope: 'local',
        associatedPou: 'aux',
        data: {
          name: 'PUMP_ON',
          class: 'local',
          type: { definition: 'base-type', value: 'bool' },
          location: '',
          documentation: '',
        },
      }).ok,
    ).toBe(true)
    const renamed = store.getState().project.data.pous.find((pou) => pou.name === 'aux')?.interface?.variables ?? []
    store.getState().snapshotActions.pushToHistory('aux', {
      variables: renamed.map((variable) => ({ ...variable, name: 'PUMP_RUN' })),
      body: '',
      globalVariables: [],
    })
    store.getState().editorActions.setEditor(CreateEditorModelObject('aux', 'st', 'program'))
    store.getState().workspaceActions.setSelectedProjectTreeLeaf({ label: 'aux', type: 'program' })
  })
})

describe('undo and redo during a debug session (TC05)', () => {
  it('should restore the earlier variable name while no debug session is open', () => {
    renderHandler()

    fire('onUndo')

    expect(currentVariableName()).toBe('PUMP_RUN')
  })

  it('should leave the variable name alone while the debugger is open', () => {
    renderHandler()
    openDebugSession()

    fire('onUndo')

    expect(currentVariableName()).toBe('PUMP_ON')
  })

  it('should restore the earlier variable name once the debug session is closed', () => {
    renderHandler()
    openDebugSession()
    closeDebugSession()

    fire('onUndo')

    expect(currentVariableName()).toBe('PUMP_RUN')
  })
})

describe('editing accelerators during a debug session (TC05, TC18)', () => {
  it.each(EDITING_ACCELERATORS)('%s changes nothing while the debugger is open', (event) => {
    renderHandler()
    openDebugSession()
    const before = JSON.stringify(store.getState().project.data)

    fire(event)

    expect(JSON.stringify(store.getState().project.data)).toBe(before)
    expect(openModals()).toEqual([])
    expect(portCalls).toEqual([])
  })

  it.each(EDITING_ACCELERATORS)('%s shows no message while the debugger is open', (event) => {
    renderHandler()
    openDebugSession()

    fire(event)

    expect(toasts()).toHaveLength(0)
  })

  it('should keep the selected program in the project while the debugger is open', () => {
    renderHandler()
    openDebugSession()

    fire('onDeleteFile')

    expect(store.getState().project.data.pous.some((pou) => pou.name === 'aux')).toBe(true)
  })

  it('should delete the selected program once the debug session is closed', () => {
    renderHandler()
    openDebugSession()
    closeDebugSession()

    fire('onDeleteFile')

    expect(openModals()).toContain('confirm-delete-element')
  })
})
