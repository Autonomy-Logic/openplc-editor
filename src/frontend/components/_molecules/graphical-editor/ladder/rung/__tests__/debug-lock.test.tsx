import {
  boolVariable,
  seriesRung,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/rung-builder'
import { act, fireEvent, screen, within } from '@testing-library/react'

import {
  installLadderScreen,
  ladderStore,
  renderLadder,
  settle,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/ladder-screen'

installLadderScreen()

const POU = 'main'

async function open() {
  const rung = seriesRung('rung_a', [
    { kind: 'contact', id: 'start', name: 'Start' },
    { kind: 'coil', id: 'motor', name: 'Motor' },
  ])
  const store = ladderStore([
    {
      name: POU,
      variables: [boolVariable('Start'), boolVariable('Motor')],
      rungs: [{ ...rung, comment: 'Run the motor' }],
    },
  ])
  const view = await renderLadder(store, POU)
  return { store, view, rungs: () => store.getState().ladderFlows[0].rungs }
}

const menuItem = (name: string) => within(screen.getByRole('menu')).getByRole('menuitem', { name: new RegExp(name) })

describe('rung gutter, menu and End rung', () => {
  it('numbers rungs from 1, shows the comment as a plain line, and collapses to a summary from the menu', async () => {
    const { view } = await open()
    expect(within(view.container).getAllByLabelText('Rung number')[0].textContent).toBe('1')
    expect(within(view.container).getByLabelText('Rung comment').textContent).toBe('Run the motor')
    expect(view.container.querySelector('[aria-label="Rung header"]')).toBeNull()

    fireEvent.contextMenu(within(view.container).getAllByLabelText('Rung gutter')[0])
    fireEvent.click(menuItem('Collapse rung'))
    await settle()
    expect(within(view.container).getByLabelText('Collapsed rung').textContent).toContain('1 contact · 1 coil')
  })

  it('duplicates a rung from the menu, and locks every editing action but collapse during a debug session', async () => {
    const { store, view, rungs } = await open()
    fireEvent.contextMenu(within(view.container).getAllByLabelText('Rung gutter')[0])
    fireEvent.click(menuItem('Duplicate rung'))
    await settle()
    expect(rungs()).toHaveLength(2)

    act(() => store.getState().workspaceActions.setDebuggerVisible(true))
    await settle()
    fireEvent.contextMenu(within(view.container).getAllByLabelText('Rung gutter')[0])
    expect(
      ['Duplicate rung', 'Edit comment', 'Delete rung'].map((name) => menuItem(name).hasAttribute('disabled')),
    ).toEqual([true, true, true])
    expect(menuItem('Collapse rung').hasAttribute('disabled')).toBe(false)
  })

  it('duplicates a rung from its hover toolbar, which keeps only collapse during a debug session', async () => {
    const { store, view, rungs } = await open()
    const toolbar = () => within(within(view.container).getAllByRole('toolbar', { name: 'Rung actions' })[0])
    fireEvent.click(toolbar().getByRole('button', { name: 'Duplicate rung' }))
    await settle()
    expect(rungs()).toHaveLength(2)

    act(() => store.getState().workspaceActions.setDebuggerVisible(true))
    await settle()
    const disabled = (name: string) => toolbar().getByRole<HTMLButtonElement>('button', { name }).disabled
    expect(['Edit comment', 'Duplicate rung', 'Delete rung', 'Collapse rung'].map(disabled)).toEqual([
      true,
      true,
      true,
      false,
    ])
  })

  it('adds a rung from the End rung, and disables it during a debug session', async () => {
    const { store, view, rungs } = await open()
    const create = within(view.container).getByLabelText<HTMLButtonElement>('Create new rung button')
    fireEvent.click(create)
    await settle()
    expect(rungs()).toHaveLength(2)

    act(() => store.getState().workspaceActions.setDebuggerVisible(true))
    await settle()
    expect(create.disabled).toBe(true)
  })
})
