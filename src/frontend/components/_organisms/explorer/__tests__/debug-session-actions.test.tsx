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

const renderExplorer = () => {
  store = createTestStore()
  act(() => {
    store.getState().projectActions.updateMetaName('Tank')
    store.getState().workspaceActions.setCanEdit(true)
    expect(store.getState().pouActions.create({ type: 'program', name: 'aux', language: 'fbd' }).ok).toBe(true)
  })
  render(<Project />, { wrapper: createStoreWrapper(store, ports) })
}

describe('actions that keep working during a debug session (TC23)', () => {
  it('should still select a program in the project tree while the debugger is open', () => {
    renderExplorer()

    openDebugSession()
    fireEvent.click(screen.getByText(/aux/))

    expect(store.getState().workspace.selectedProjectTreeLeaf).toEqual({ label: 'aux', type: 'program' })
  })

  it('should still open the program as a tab while the debugger is open', () => {
    renderExplorer()

    openDebugSession()
    fireEvent.doubleClick(screen.getByText(/aux/))

    expect(store.getState().tabs.some((tab) => tab.name === 'aux')).toBe(true)
  })
})
