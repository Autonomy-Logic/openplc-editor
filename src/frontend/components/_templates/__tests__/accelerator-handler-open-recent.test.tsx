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

const projectPort = new Proxy<ProjectPort>(Object.create(null), {
  get: (_, prop) => (prop === 'openProjectByPath' ? openProjectByPath : () => undefined),
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

it('forgets the path when the save prompt is cancelled', async () => {
  openProjectByPath.mockResolvedValue({ success: true, data: parsed })
  act(() => store.getState().workspaceActions.setEditingState('unsaved'))
  renderHandler()

  await openRecent('/projects/demo')

  const data: unknown = store.getState().modals['save-changes-project']?.data
  const callbacks = typeof data === 'object' && data !== null ? data : {}
  const onActionAborted: unknown = 'onActionAborted' in callbacks ? callbacks.onActionAborted : undefined
  const onAfterAction: unknown = 'onAfterAction' in callbacks ? callbacks.onAfterAction : undefined
  if (typeof onActionAborted !== 'function' || typeof onAfterAction !== 'function') {
    throw new Error('save modal is missing its callbacks')
  }
  await act(async () => {
    onActionAborted('cancelled')
    onAfterAction()
    await Promise.resolve()
  })

  expect(openProjectByPath).not.toHaveBeenCalled()
  expect(handleOpenProjectResponse).not.toHaveBeenCalled()
})
