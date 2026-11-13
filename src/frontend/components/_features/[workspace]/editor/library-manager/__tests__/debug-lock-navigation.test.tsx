import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import type { InstalledLibrary } from '@root/middleware/shared/ports/library-types'
import { act, render, screen } from '@testing-library/react'

import type { OpenPLCStore } from '@root/frontend/store'

import { ProjectLibrariesTab } from '../project-libraries-tab'

let store: OpenPLCStore

const installed: InstalledLibrary[] = [
  {
    name: 'motion',
    version: '1.0.0',
    bundled: false,
    origin: 'stlib',
    installedAt: new Date().toISOString(),
    displayName: 'Motion',
  },
]

const openDebugSession = () =>
  act(() => {
    store.getState().workspaceActions.setDebuggerVisible(true)
  })

const search = () => screen.getByPlaceholderText<HTMLInputElement>('Search libraries…')

const renderTab = () => {
  store = createTestStore()
  render(<ProjectLibrariesTab installed={installed} />, { wrapper: createStoreWrapper(store) })
}

describe('the project libraries tab during a debug session', () => {
  it('should leave the search usable while no debug session is open', () => {
    renderTab()

    expect(search().matches(':disabled')).toBe(false)
  })

  it('should keep the search usable while the debugger is open', () => {
    renderTab()

    openDebugSession()

    expect(search().matches(':disabled')).toBe(false)
  })

  it('should lock the add action while the debugger is open', () => {
    renderTab()

    openDebugSession()

    expect(screen.getByRole('button', { name: /add to project/i }).matches(':disabled')).toBe(true)
  })
})
