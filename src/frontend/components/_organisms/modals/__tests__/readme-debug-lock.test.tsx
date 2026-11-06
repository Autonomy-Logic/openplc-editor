import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { act, fireEvent, render, screen } from '@testing-library/react'

// react-markdown and remark-gfm ship ESM only, which the editor's Jest transform cannot parse.
vi.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children?: string }) => <div data-testid='markdown'>{children}</div>,
}))
vi.mock('remark-gfm', () => ({ __esModule: true, default: () => undefined }))

import type { OpenPLCStore } from '@root/frontend/store'

import { ProjectReadmeModal } from '../project-readme-modal'

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

const draftField = () => screen.queryByPlaceholderText<HTMLTextAreaElement>('Write your README in markdown...')

const openReadme = () => {
  store = createTestStore()
  act(() => {
    store.getState().workspaceActions.setCanEdit(true)
    store.getState().readmeActions.commitSaved('# Tank')
    store.getState().modalActions.openModal('project-readme')
  })
  render(<ProjectReadmeModal />, { wrapper: createStoreWrapper(store, ports) })
}

const startEditing = () => {
  const edit = screen.queryByRole('button', { name: /edit/i })
  if (edit) fireEvent.click(edit)
}

describe('project README during a debug session (TC16)', () => {
  it('should let the draft be edited while no debug session is open', () => {
    openReadme()
    startEditing()

    const field = draftField()
    expect(field).not.toBeNull()
    expect(field?.readOnly).toBe(false)
  })

  it('should make the draft read only while the debugger is open', () => {
    openReadme()
    startEditing()

    openDebugSession()

    expect(draftField()?.readOnly).toBe(true)
  })

  it('should keep the README text unchanged when the locked draft is typed into', () => {
    openReadme()
    startEditing()

    openDebugSession()
    const field = draftField()
    if (field) fireEvent.change(field, { target: { value: 'draft' } })

    expect(store.getState().readme.draftContent).toBe('# Tank')
  })

  it('should release the draft once the debug session is closed', () => {
    openReadme()
    startEditing()

    openDebugSession()
    closeDebugSession()

    expect(draftField()?.readOnly).toBe(false)
  })
})
