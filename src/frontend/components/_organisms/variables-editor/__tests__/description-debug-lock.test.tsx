import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react'
import type { ReactElement } from 'react'

// The variables code editor pulls in Monaco, which cannot run in jsdom.
vi.mock('@root/frontend/components/_organisms/variables-code-editor', () => ({
  VariablesCodeEditor: () => <div data-testid='variables-code-editor' />,
}))

import type { OpenPLCStore } from '../../../../store'
import { createStoreWrapper, createTestStore } from '../../../../store/testing'
import { VariablesEditor } from '../index'

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

const descriptionField = () => screen.getByLabelText<HTMLInputElement>('Description :')

const pouDocumentation = () => store.getState().project.data.pous.find((pou) => pou.name === 'main')?.documentation

const renderProgram = () => {
  expect(store.getState().pouActions.create({ type: 'program', name: 'main', language: 'ld' }).ok).toBe(true)
  act(() => {
    store.getState().projectActions.updatePouDocumentation('main', 'Tank control')
  })
  render(<VariablesEditor name='main' />)
}

describe('POU description field during a debug session (TC09)', () => {
  beforeEach(() => {
    store = createTestStore()
  })

  it('should accept a new description when no debug session is open', () => {
    renderProgram()

    fireEvent.change(descriptionField(), { target: { value: 'Tank control v2' } })
    fireEvent.blur(descriptionField())

    expect(pouDocumentation()).toBe('Tank control v2')
  })

  it('should disable the description field while the debugger is open', () => {
    renderProgram()

    openDebugSession()

    expect(descriptionField().disabled).toBe(true)
  })

  it('should give the locked description field the not-allowed cursor', () => {
    renderProgram()

    openDebugSession()

    expect(descriptionField().className).toContain('disabled:cursor-not-allowed')
  })

  it('should keep the description unchanged when the locked field is typed into', () => {
    renderProgram()

    openDebugSession()
    fireEvent.change(descriptionField(), { target: { value: 'Tank control v2' } })
    fireEvent.blur(descriptionField())

    expect(pouDocumentation()).toBe('Tank control')
    expect(descriptionField().value).toBe('Tank control')
  })

  it('should release the description field once the debug session is closed', () => {
    renderProgram()

    openDebugSession()
    closeDebugSession()

    expect(descriptionField().disabled).toBe(false)
  })
})
