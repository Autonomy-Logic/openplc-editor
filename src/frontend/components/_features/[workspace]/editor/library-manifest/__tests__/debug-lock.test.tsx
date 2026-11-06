import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import { act, render, screen } from '@testing-library/react'

// Monaco cannot run in jsdom; the stub publishes the options the editor asks for.
const MonacoStub = ({ options }: { options?: { readOnly?: boolean } }) => (
  <div data-testid='monaco-stub' data-read-only={options?.readOnly === true ? 'true' : 'false'} />
)

vi.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: MonacoStub,
  Editor: MonacoStub,
  loader: { config: () => undefined, init: () => Promise.resolve(undefined) },
}))

import type { OpenPLCStore } from '@root/frontend/store'

import { LibraryManifestEditor } from '../index'

let store: OpenPLCStore

const openDebugSession = () =>
  act(() => {
    store.getState().workspaceActions.setDebuggerVisible(true)
  })

const closeDebugSession = () =>
  act(() => {
    store.getState().workspaceActions.clearDebugState()
  })

const isReadOnly = () => screen.getByTestId('monaco-stub').getAttribute('data-read-only')

describe('library manifest editor during a debug session (TC11)', () => {
  beforeEach(() => {
    store = createTestStore()
    render(<LibraryManifestEditor />, { wrapper: createStoreWrapper(store) })
  })

  it('should stay writable while no debug session is open', () => {
    expect(isReadOnly()).toBe('false')
  })

  it('should turn read only while the debugger is open', () => {
    openDebugSession()

    expect(isReadOnly()).toBe('true')
  })

  it('should turn writable again once the debug session is closed', () => {
    openDebugSession()
    closeDebugSession()

    expect(isReadOnly()).toBe('false')
  })
})
