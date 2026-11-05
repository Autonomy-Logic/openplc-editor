import { act, render as rtlRender, screen, within } from '@testing-library/react'
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

/**
 * Both copies are in the DOM at once; CSS alone picks the one the width shows.
 * The description row carries the same aria-label, so the Add button tells the
 * action bars apart.
 */
const actionBars = () =>
  screen
    .getAllByLabelText('Variables editor table actions container')
    .filter((bar) => within(bar).queryByLabelText('Add table row button') !== null)

const actionButtons = (bar: HTMLElement) => within(bar).getAllByRole<HTMLButtonElement>('button')

const renderProgram = () => {
  expect(store.getState().pouActions.create({ type: 'program', name: 'main', language: 'ld' }).ok).toBe(true)
  render(<VariablesEditor name='main' />)
}

describe('variables editor action bar during a debug session (DOPE-786)', () => {
  beforeEach(() => {
    store = createTestStore()
  })

  it('should render both the wide and the narrow action bar', () => {
    renderProgram()

    expect(actionBars()).toHaveLength(2)
  })

  it('should disable every action of every bar while the debugger is open', () => {
    renderProgram()

    openDebugSession()

    for (const bar of actionBars()) {
      for (const button of actionButtons(bar)) {
        expect(button.disabled).toBe(true)
      }
    }
  })

  it('should disable the Add button of the narrow bar, which stayed live before this change', () => {
    renderProgram()

    openDebugSession()

    for (const bar of actionBars()) {
      expect(within(bar).getByLabelText<HTMLButtonElement>('Add table row button').disabled).toBe(true)
    }
  })

  it('should give every locked action the not-allowed cursor', () => {
    renderProgram()

    openDebugSession()

    for (const bar of actionBars()) {
      for (const button of actionButtons(bar)) {
        expect(button.className).toContain('disabled:cursor-not-allowed')
        expect(button.className).not.toContain('disabled:pointer-events-none')
      }
    }
  })

  it('should add no tooltip text to a locked action', () => {
    renderProgram()
    const before = actionBars().flatMap((bar) => actionButtons(bar).map((b) => b.title))

    openDebugSession()

    expect(actionBars().flatMap((bar) => actionButtons(bar).map((b) => b.title))).toEqual(before)
  })

  it('should enable the Add button of both bars again once the debugger closes', () => {
    renderProgram()

    openDebugSession()
    closeDebugSession()

    for (const bar of actionBars()) {
      expect(within(bar).getByLabelText<HTMLButtonElement>('Add table row button').disabled).toBe(false)
    }
  })

  it('should keep the view mode toggle usable while the debugger is open', () => {
    renderProgram()

    openDebugSession()

    for (const toggle of screen.getAllByLabelText('Variables visualization switch container')) {
      for (const button of within(toggle).getAllByRole<HTMLButtonElement>('button')) {
        expect(button.disabled).toBe(false)
      }
    }
  })
})
