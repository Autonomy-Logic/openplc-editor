import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type {
  Branch,
  PendingChange,
  Stash,
  VersionControlPort,
} from '@root/middleware/shared/ports/version-control-port'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { OpenPLCStore } from '@root/frontend/store'

import { BranchSwitcherPopover } from '../../branches/branch-switcher-popover'
import { ChangesSection } from '../changes-section'
import { StashSection } from '../stash-section'

/** A port whose every method answers `undefined`, except the ones handed in. */
function stubPort<T extends object>(overrides: Partial<T> = {}): T {
  return new Proxy(overrides as T, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

const change: PendingChange = { path: 'pous/programs/main.st', status: 'modified' }

const stash: Stash = {
  ref: 'stash@{0}',
  index: 0,
  hash: 'abc123',
  message: 'work in progress',
  branch: 'development',
  createdAt: new Date().toISOString(),
}

const branches: Branch[] = [
  {
    id: 'b1',
    projectId: '/projects/tank',
    name: 'development',
    isDefault: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'b2',
    projectId: '/projects/tank',
    name: 'feature-x',
    isDefault: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
]

const versionControl = stubPort<VersionControlPort>({
  getChanges: () => Promise.resolve({ changes: [change], hasChanges: true }),
  listStashes: () => Promise.resolve({ stashes: [stash] }),
  listBranches: () => Promise.resolve({ branches }),
})

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
  versionControl,
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

const button = (name: string | RegExp) => screen.getByRole<HTMLButtonElement>('button', { name })

const renderSection = async (ui: React.ReactElement, settled: () => void) => {
  store = createTestStore()
  act(() => {
    store.getState().workspaceActions.setCanEdit(true)
  })
  render(ui, { wrapper: createStoreWrapper(store, ports) })
  await waitFor(settled)
}

describe('pending changes during a debug session (TC15, TC74)', () => {
  const renderChanges = () =>
    renderSection(<ChangesSection projectId='/projects/tank' />, () => {
      expect(screen.getByText(/main\.st/)).toBeTruthy()
    })

  it('should offer Discard and Stash while no debug session is open', async () => {
    await renderChanges()

    expect(button('Discard').disabled).toBe(false)
    expect(button('Stash').disabled).toBe(false)
  })

  it('should disable Discard and Stash while the debugger is open', async () => {
    await renderChanges()

    openDebugSession()

    expect(button('Discard').disabled).toBe(true)
    expect(button('Stash').disabled).toBe(true)
  })

  it('should keep Commit available while the debugger is open (TC74)', async () => {
    await renderChanges()
    // Commit needs a message and a selected file; the files start selected.
    fireEvent.change(screen.getByPlaceholderText('Commit message...'), { target: { value: 'work' } })

    openDebugSession()

    expect(button(/^commit$/i).disabled).toBe(false)
  })

  it('should release Discard and Stash once the debug session is closed', async () => {
    await renderChanges()

    openDebugSession()
    closeDebugSession()

    expect(button('Discard').disabled).toBe(false)
  })
})

describe('the stash list during a debug session (TC15)', () => {
  const renderStashes = () =>
    renderSection(<StashSection projectId='/projects/tank' />, () => {
      expect(screen.getByText('work in progress')).toBeTruthy()
    })

  it('should offer Apply and Pop while no debug session is open', async () => {
    await renderStashes()

    expect(button('Apply').disabled).toBe(false)
    expect(button(/pop/i).disabled).toBe(false)
  })

  it('should disable Apply and Pop while the debugger is open', async () => {
    await renderStashes()

    openDebugSession()

    expect(button('Apply').disabled).toBe(true)
    expect(button(/pop/i).disabled).toBe(true)
  })

  it('should still list the stashes while the debugger is open', async () => {
    await renderStashes()

    openDebugSession()

    expect(screen.getByText('work in progress')).toBeTruthy()
  })

  it('should release Apply once the debug session is closed', async () => {
    await renderStashes()

    openDebugSession()
    closeDebugSession()

    expect(button('Apply').disabled).toBe(false)
  })
})

describe('the branch switcher during a debug session (TC15)', () => {
  const switched: string[] = []
  const merged: string[] = []

  const renderSwitcher = () =>
    renderSection(
      <BranchSwitcherPopover
        isOpen
        projectId='/projects/tank'
        currentBranchName='development'
        onClose={() => undefined}
        onSelect={(branch) => switched.push(branch.name)}
        onDelete={() => undefined}
        onMerge={(branch) => merged.push(branch.name)}
      />,
      () => {
        expect(screen.getByText('feature-x')).toBeTruthy()
      },
    )

  beforeEach(() => {
    switched.length = 0
    merged.length = 0
  })

  it('should switch branch while no debug session is open', async () => {
    await renderSwitcher()

    fireEvent.click(screen.getByText('feature-x'))

    expect(switched).toEqual(['feature-x'])
  })

  it('should switch no branch while the debugger is open', async () => {
    await renderSwitcher()

    openDebugSession()
    fireEvent.click(screen.getByText('feature-x'))

    expect(switched).toEqual([])
  })

  it('should still list the branches while the debugger is open', async () => {
    await renderSwitcher()

    openDebugSession()

    expect(screen.getByText('feature-x')).toBeTruthy()
  })

  it('should switch branch again once the debug session is closed', async () => {
    await renderSwitcher()

    openDebugSession()
    closeDebugSession()
    fireEvent.click(screen.getByText('feature-x'))

    expect(switched).toEqual(['feature-x'])
  })
})
