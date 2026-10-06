/**
 * The native Recent menu sends only a project path. The handler opens it through the project
 * port, the same way the Start screen's Recent list does, so the project is parsed here and the
 * main process sets its file-access root.
 */

import { act, render } from '@testing-library/react'
import type { AcceleratorPort } from '../../../../middleware/shared/ports/accelerator-port'
import { EDITOR_CAPABILITIES } from '../../../../middleware/shared/ports/platform-capabilities'
import type { ProjectPort, ProjectResponse } from '../../../../middleware/shared/ports/project-port'
import type { PlatformPorts } from '../../../../middleware/shared/providers/types'
import type { OpenPLCStore } from '../../../store'
import type { OpenProjectResponseData } from '../../../store/slices/shared/types'
import { createStoreWrapper, createTestStore } from '../../../store/testing'
import { toast } from '../../_features/[app]/toast/use-toast'
import { AcceleratorHandler } from '../accelerator-handler'

jest.mock('../../_features/[app]/toast/use-toast', () => ({ toast: jest.fn() }))

const listeners = new Map<string, (...args: unknown[]) => void>()

const accelerator = new Proxy<AcceleratorPort>(Object.create(null), {
  get: (_, prop) =>
    typeof prop === 'string'
      ? (callback: (...args: unknown[]) => void) => {
          listeners.set(prop, callback)
          return () => {
            if (listeners.get(prop) === callback) listeners.delete(prop)
          }
        }
      : undefined,
})

function stubPort<T extends object>(): T {
  const target: T = Object.create(null)
  return new Proxy(target, {
    get: (_, prop) => (typeof prop === 'string' ? () => undefined : undefined),
  })
}

const openProjectByPath = jest.fn<Promise<ProjectResponse>, [string]>()
const openProject = jest.fn<Promise<ProjectResponse>, []>()

const projectPort = new Proxy<ProjectPort>(Object.create(null), {
  get: (_, prop) =>
    prop === 'openProjectByPath' ? openProjectByPath : prop === 'openProject' ? openProject : () => undefined,
})

function makePorts(): PlatformPorts {
  return {
    compiler: stubPort(),
    runtime: stubPort(),
    debugger: stubPort(),
    simulator: stubPort(),
    project: projectPort,
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

async function openRecent(projectPath: string) {
  const callback = listeners.get('onOpenRecent')
  if (!callback) throw new Error('nothing subscribed to onOpenRecent')
  await act(async () => {
    callback(projectPath)
    await Promise.resolve()
  })
}

const handleOpenProjectResponse = jest.fn<void, [OpenProjectResponseData]>()

const parsed: OpenProjectResponseData = {
  meta: { name: 'demo', type: 'plc-project', path: '/projects/demo' },
  projectData: {
    dataTypes: [],
    pous: [],
    configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
  },
}

beforeEach(() => {
  store = createTestStore()
  store.setState({
    sharedWorkspaceActions: { ...store.getState().sharedWorkspaceActions, handleOpenProjectResponse },
  })
  listeners.clear()
  jest.clearAllMocks()
})

it('opens the path through the project port and loads the parsed project', async () => {
  openProjectByPath.mockResolvedValue({ success: true, data: parsed })
  renderHandler()

  await openRecent('/projects/demo')

  expect(openProjectByPath).toHaveBeenCalledWith('/projects/demo')
  expect(handleOpenProjectResponse).toHaveBeenCalledWith(parsed)
})

it('reports a project that cannot be opened and loads nothing', async () => {
  openProjectByPath.mockResolvedValue({ success: false, error: { title: 'Error', description: 'Gone.' } })
  renderHandler()

  await openRecent('/projects/gone')

  expect(handleOpenProjectResponse).not.toHaveBeenCalled()
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Gone.', variant: 'fail' }))
})

it('reports a port that rejects instead of throwing', async () => {
  openProjectByPath.mockRejectedValue(new Error('IPC failed'))
  renderHandler()

  await openRecent('/projects/demo')

  expect(handleOpenProjectResponse).not.toHaveBeenCalled()
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'fail' }))
})

it('asks to save unsaved changes before reading the project', async () => {
  openProjectByPath.mockResolvedValue({ success: true, data: parsed })
  act(() => store.getState().workspaceActions.setEditingState('unsaved'))
  renderHandler()

  await openRecent('/projects/demo')

  const modal = store.getState().modals['save-changes-project']
  expect(modal?.open).toBe(true)
  expect(openProjectByPath).not.toHaveBeenCalled()

  const data: unknown = modal?.data
  const onAfterAction: unknown =
    typeof data === 'object' && data !== null && 'onAfterAction' in data ? data.onAfterAction : undefined
  if (typeof onAfterAction !== 'function') throw new Error('save modal has no follow-up')
  await act(async () => {
    onAfterAction()
    await Promise.resolve()
  })

  expect(openProjectByPath).toHaveBeenCalledWith('/projects/demo')
  expect(handleOpenProjectResponse).toHaveBeenCalledWith(parsed)
})

describe('an edit made while the read is pending', () => {
  function modalCallbacks() {
    const data: unknown = store.getState().modals['save-changes-project']?.data
    const callbacks = typeof data === 'object' && data !== null ? data : {}
    const onAfterAction: unknown = 'onAfterAction' in callbacks ? callbacks.onAfterAction : undefined
    const onActionAborted: unknown = 'onActionAborted' in callbacks ? callbacks.onActionAborted : undefined
    if (typeof onAfterAction !== 'function' || typeof onActionAborted !== 'function') {
      throw new Error('save modal is missing its callbacks')
    }
    return { onAfterAction, onActionAborted }
  }

  beforeEach(() => {
    act(() => store.getState().projectActions.updateMetaPath('/projects/current'))
    openProjectByPath.mockImplementation((path) => {
      if (path === '/projects/demo') store.getState().workspaceActions.setEditingState('unsaved')
      return Promise.resolve({ success: true, data: parsed })
    })
  })

  it('asks to save before replacing the project, then loads what was read', async () => {
    renderHandler()

    await openRecent('/projects/demo')

    expect(store.getState().modals['save-changes-project']?.open).toBe(true)
    expect(handleOpenProjectResponse).not.toHaveBeenCalled()

    act(() => modalCallbacks().onAfterAction())

    expect(handleOpenProjectResponse).toHaveBeenCalledWith(parsed)
    expect(openProjectByPath).toHaveBeenCalledTimes(1)
  })

  it('re-reads the open project when the prompt is cancelled, so the file-access root follows it back', async () => {
    renderHandler()

    await openRecent('/projects/demo')
    await act(async () => {
      modalCallbacks().onActionAborted('cancelled')
      await Promise.resolve()
    })

    expect(openProjectByPath).toHaveBeenLastCalledWith('/projects/current')
    expect(handleOpenProjectResponse).not.toHaveBeenCalled()
  })
})

describe('an open that fails past the read', () => {
  async function fire(event: string) {
    const callback = listeners.get(event)
    if (!callback) throw new Error(`nothing subscribed to ${event}`)
    await act(async () => {
      callback()
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  beforeEach(() => {
    act(() => store.getState().projectActions.updateMetaPath('/projects/current'))
  })

  it('re-reads the open project when a native Recent open rejects', async () => {
    openProjectByPath.mockImplementation((path) =>
      path === '/projects/demo'
        ? Promise.reject(new Error('parse failed'))
        : Promise.resolve({ success: true, data: parsed }),
    )
    renderHandler()

    await openRecent('/projects/demo')

    expect(openProjectByPath).toHaveBeenLastCalledWith('/projects/current')
    expect(handleOpenProjectResponse).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'fail' }))
  })

  it('leaves the root alone when a native Recent open reports it could not read the project', async () => {
    openProjectByPath.mockResolvedValue({ success: false, error: { title: 'Error', description: 'Gone.' } })
    renderHandler()

    await openRecent('/projects/gone')

    expect(openProjectByPath).toHaveBeenCalledTimes(1)
  })

  it('re-reads the open project when File > Open rejects', async () => {
    openProject.mockRejectedValue(new Error('parse failed'))
    openProjectByPath.mockResolvedValue({ success: true, data: parsed })
    renderHandler()

    await fire('onOpenProject')

    expect(openProjectByPath).toHaveBeenCalledWith('/projects/current')
    expect(handleOpenProjectResponse).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'fail' }))
  })

  it('does nothing more when the File > Open picker is cancelled', async () => {
    openProject.mockResolvedValue({ success: false, error: { title: 'Cancelled', description: 'No project selected' } })
    renderHandler()

    await fire('onOpenProject')

    expect(openProjectByPath).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })
})
