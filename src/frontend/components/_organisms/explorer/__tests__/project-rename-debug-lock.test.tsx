import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { act, fireEvent, render, screen } from '@testing-library/react'

import type { OpenPLCStore } from '@root/frontend/store'

import { Project } from '../project'

/** A port whose every method answers `undefined`. */
function stubPort<T extends object>(overrides: Partial<T> = {}): T {
  return new Proxy(overrides as T, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

const ports: PlatformPorts = {
  compiler: stubPort(),
  runtime: stubPort(),
  debugger: stubPort(),
  simulator: stubPort(),
  project: stubPort(),
  device: stubPort(),
  orchestrator: stubPort(),
  system: stubPort(),
  window: stubPort(),
  accelerator: stubPort(),
  theme: stubPort(),
  versionControl: stubPort(),
  navigation: stubPort(),
  library: stubPort(),
  capabilities: EDITOR_CAPABILITIES,
}

let store: OpenPLCStore

const openDebugSession = () =>
  act(() => {
    store.getState().workspaceActions.setDebuggerVisible(true)
  })

const closeDebugSession = () =>
  act(() => {
    store.getState().workspaceActions.clearDebugState()
  })

const nameContainer = () => {
  const container = document.getElementById('project-name-container')
  if (!container) throw new Error('no project name container')
  return container
}

const renameField = () => screen.queryByDisplayValue('Tank')

const renderExplorer = () => {
  store = createTestStore()
  act(() => {
    store.getState().projectActions.updateMetaName('Tank')
    store.getState().workspaceActions.setCanEdit(true)
  })
  render(<Project />, { wrapper: createStoreWrapper(store, ports) })
}

describe('project rename during a debug session (TC16)', () => {
  it('should open the rename field when no debug session is open', () => {
    renderExplorer()

    fireEvent.click(nameContainer())

    expect(renameField()).not.toBeNull()
  })

  it('should open no rename field while the debugger is open', () => {
    renderExplorer()

    openDebugSession()
    fireEvent.click(nameContainer())

    expect(renameField()).toBeNull()
  })

  it('should keep the project name unchanged while the debugger is open', () => {
    renderExplorer()

    openDebugSession()
    fireEvent.click(nameContainer())

    expect(store.getState().project.meta.name).toBe('Tank')
  })

  it('should open the rename field again once the debug session is closed', () => {
    renderExplorer()

    openDebugSession()
    closeDebugSession()
    fireEvent.click(nameContainer())

    expect(renameField()).not.toBeNull()
  })
})
