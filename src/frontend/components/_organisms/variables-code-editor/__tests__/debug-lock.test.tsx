import { act, render as rtlRender, screen } from '@testing-library/react'
import type { ReactElement } from 'react'

// Monaco cannot run in jsdom; the stub publishes the options the editor asks for.
vi.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: ({ options }: { options?: { readOnly?: boolean } }) => (
    <div data-testid='monaco-stub' data-read-only={options?.readOnly === true ? 'true' : 'false'} />
  ),
}))

import type { OpenPLCStore } from '../../../../store'
import { createStoreWrapper, createTestStore } from '../../../../store/testing'
import { VariablesCodeEditor } from '../index'

let store: OpenPLCStore

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: createStoreWrapper(store) })

const openDebugSession = () =>
  act(() => {
    store.getState().workspaceActions.setDebuggerVisible(true)
  })

const closeDebugSession = () =>
  act(() => {
    store.getState().workspaceActions.clearDebugState()
  })

const isReadOnly = () => screen.getByTestId('monaco-stub').getAttribute('data-read-only')

const renderCodeView = () =>
  render(<VariablesCodeEditor code='VAR\nEND_VAR' onCodeChange={() => undefined} shouldUseDarkMode={false} />)

describe('variables code view during a debug session (TC10)', () => {
  beforeEach(() => {
    store = createTestStore()
  })

  it('should stay writable while no debug session is open', () => {
    renderCodeView()

    expect(isReadOnly()).toBe('false')
  })

  it('should turn read only while the debugger is open', () => {
    renderCodeView()

    openDebugSession()

    expect(isReadOnly()).toBe('true')
  })

  it('should turn writable again once the debug session is closed', () => {
    renderCodeView()

    openDebugSession()
    closeDebugSession()

    expect(isReadOnly()).toBe('false')
  })

  it('should keep an already read-only code view read only while the debugger is open', () => {
    render(
      <VariablesCodeEditor code='VAR\nEND_VAR' onCodeChange={() => undefined} shouldUseDarkMode={false} readOnly />,
    )

    openDebugSession()

    expect(isReadOnly()).toBe('true')
  })

  it('should keep an already read-only code view read only after the session closes', () => {
    render(
      <VariablesCodeEditor code='VAR\nEND_VAR' onCodeChange={() => undefined} shouldUseDarkMode={false} readOnly />,
    )

    openDebugSession()
    closeDebugSession()

    expect(isReadOnly()).toBe('true')
  })
})
