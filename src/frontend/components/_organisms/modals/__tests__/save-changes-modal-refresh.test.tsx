/**
 * The save-changes prompt in front of a Refresh: only an answered prompt reloads.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'

import { EDITOR_CAPABILITIES } from '../../../../../middleware/shared/ports/platform-capabilities'
import type { WindowPort } from '../../../../../middleware/shared/ports/window-port'
import { PlatformProvider } from '../../../../../middleware/shared/providers'
import type { PlatformPorts } from '../../../../../middleware/shared/providers/types'
import { openPLCStoreBase } from '../../../../store'
import { SaveChangesModal } from '../save-changes-modal'

function stubPort<T extends object>(overrides: Partial<T> = {}): T {
  const target: T = Object.create(null)
  return new Proxy(target, {
    get: (_, prop) => {
      if (Reflect.has(overrides, prop)) return Reflect.get(overrides, prop)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

let reloads = 0

function makePorts(): PlatformPorts {
  return {
    compiler: stubPort(),
    runtime: stubPort(),
    debugger: stubPort(),
    simulator: stubPort(),
    project: stubPort(),
    device: stubPort(),
    orchestrator: stubPort(),
    system: stubPort(),
    window: stubPort<WindowPort>({
      reload: () => {
        reloads += 1
      },
    }),
    accelerator: stubPort(),
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

const initialState = openPLCStoreBase.getState()

function renderRefreshPrompt() {
  render(<SaveChangesModal isOpen validationContext='refresh-app' />, { wrapper: Wrapper })
}

beforeEach(() => {
  openPLCStoreBase.setState(initialState, true)
  openPLCStoreBase.getState().workspaceActions.setEditingState('unsaved')
  reloads = 0
})

describe('save-changes prompt before a refresh', () => {
  it('reloads after "Close without saving"', async () => {
    renderRefreshPrompt()

    await userEvent.click(screen.getByRole('button', { name: /close without saving/i }))

    expect(reloads).toBe(1)
  })

  it('clears the unsaved flag before reloading, so the web unload guard does not ask again', async () => {
    renderRefreshPrompt()

    await userEvent.click(screen.getByRole('button', { name: /close without saving/i }))

    expect(openPLCStoreBase.getState().workspace.editingState).not.toBe('unsaved')
  })

  it('does not reload on Cancel', async () => {
    renderRefreshPrompt()

    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }))

    expect(reloads).toBe(0)
    expect(openPLCStoreBase.getState().workspace.editingState).toBe('unsaved')
  })

  it('does not reload when the save fails', async () => {
    openPLCStoreBase.setState((s) => ({ ...s, workspace: { ...s.workspace, canEdit: false } }))
    renderRefreshPrompt()

    await userEvent.click(screen.getByRole('button', { name: /save and close/i }))

    expect(reloads).toBe(0)
  })
})
