import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type {
  BranchCommitInfo,
  BranchDiffWithBase,
  VersionControlPort,
} from '@root/middleware/shared/ports/version-control-port'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@monaco-editor/react', () => ({
  __esModule: true,
  DiffEditor: () => <div data-testid='diff-editor' />,
  default: () => <div data-testid='monaco-stub' />,
}))

import type { OpenPLCStore } from '@root/frontend/store'

import { BranchMergeView } from '../branch-merge-view'

/** A port whose every method answers `undefined`, except the ones handed in. */
function stubPort<T extends object>(overrides: Partial<T> = {}): T {
  return new Proxy(overrides as T, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

const commit: BranchCommitInfo = {
  hash: 'a'.repeat(40),
  shortHash: 'aaaaaaa',
  message: 'work',
  author: 'dev',
  authorEmail: 'dev@example.com',
  timestamp: new Date().toISOString(),
  branch: 'feature-x',
  parentHash: null,
}

const diff: BranchDiffWithBase = {
  source: {
    branch: 'feature-x',
    commit,
    files: [{ path: 'pous/programs/main.st', content: 'PROGRAM main\nEND_PROGRAM\n', type: 'file' }],
  },
  target: {
    branch: 'development',
    commit: { ...commit, branch: 'development' },
    files: [{ path: 'pous/programs/main.st', content: 'PROGRAM main\n\nEND_PROGRAM\n', type: 'file' }],
  },
  base: null,
  conflicts: [],
}

const merged: string[] = []

const versionControl = stubPort<VersionControlPort>({
  getBranchDiffWithBase: () => Promise.resolve(diff),
  listBranches: () => Promise.resolve({ branches: [] }),
  mergeBranches: ({ sourceBranch }) => {
    merged.push(sourceBranch)
    return Promise.resolve({
      message: 'merged',
      mergeCommit: commit,
      sourceBranch,
      targetBranch: 'development',
    })
  },
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

const button = (name: string | RegExp) => screen.getByRole<HTMLButtonElement>('button', { name })

const openMergeOptions = async () => {
  store = createTestStore()
  merged.length = 0
  render(
    <BranchMergeView
      projectId='/projects/tank'
      sourceBranch='feature-x'
      targetParam='development'
      onBack={() => undefined}
      onMerged={() => undefined}
    />,
    { wrapper: createStoreWrapper(store, ports) },
  )
  await waitFor(() => expect(button(/merge into development/i).disabled).toBe(false))
  fireEvent.click(button(/merge into development/i))
  await waitFor(() => expect(button(/merge and don't delete/i)).toBeTruthy())
}

describe('the merge confirmation during a debug session', () => {
  it('should merge while no debug session is open', async () => {
    await openMergeOptions()

    fireEvent.click(button(/merge and don't delete/i))

    await waitFor(() => expect(merged).toEqual(['feature-x']))
  })

  it('should merge nothing when the confirmation is confirmed after the session starts', async () => {
    await openMergeOptions()

    openDebugSession()
    fireEvent.click(button(/merge and don't delete/i))

    await waitFor(() => expect(merged).toEqual([]))
  })
})
