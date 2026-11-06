import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react'
import type { ReactElement } from 'react'

import type { OpenPLCStore } from '../../../../store'
import { createStoreWrapper, createTestStore } from '../../../../store/testing'
import TableActions from '../../table-actions'
import { GenericButtonCell } from '../generic-button-cell'
import { GenericComboboxCell } from '../generic-combobox-cell'
import { GenericSelectCell } from '../generic-select-cell'
import { GenericTextCell } from '../generic-text-cell'

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

describe('shared table primitives during a debug session (TC11)', () => {
  beforeEach(() => {
    store = createTestStore()
  })

  describe('TableActions', () => {
    const actions = [
      { ariaLabel: 'Add table row button', onClick: () => undefined, icon: <span>+</span> },
      { ariaLabel: 'Remove table row button', onClick: () => undefined, icon: <span>-</span> },
    ]
    const buttons = () => screen.getAllByRole<HTMLButtonElement>('button')

    it('should leave the actions available while no debug session is open', () => {
      render(<TableActions actions={actions} />)

      expect(buttons().every((button) => button.disabled)).toBe(false)
    })

    it('should disable every action while the debugger is open', () => {
      render(<TableActions actions={actions} />)

      openDebugSession()

      expect(buttons().every((button) => button.disabled)).toBe(true)
    })

    it('should fire no handler when a locked action is clicked', () => {
      const calls: string[] = []
      render(
        <TableActions
          actions={[{ ariaLabel: 'Add table row button', onClick: () => calls.push('add'), icon: <span>+</span> }]}
        />,
      )

      openDebugSession()
      fireEvent.click(screen.getByLabelText('Add table row button'))

      expect(calls).toHaveLength(0)
    })

    it('should keep an action its caller already disabled disabled after the session closes', () => {
      render(
        <TableActions
          actions={[
            { ariaLabel: 'Remove table row button', onClick: () => undefined, disabled: true, icon: <span>-</span> },
          ]}
        />,
      )

      openDebugSession()
      closeDebugSession()

      expect(screen.getByLabelText<HTMLButtonElement>('Remove table row button').disabled).toBe(true)
    })

    it('should release the actions once the debug session is closed', () => {
      render(<TableActions actions={actions} />)

      openDebugSession()
      closeDebugSession()

      expect(buttons().some((button) => button.disabled)).toBe(false)
    })
  })

  describe('GenericTextCell', () => {
    const renderCell = (onChange: (value: string) => void = () => undefined) =>
      render(<GenericTextCell value='TANK_LEVEL' onChange={onChange} onBlur={() => undefined} editable selected />)

    it('should open an input when clicked while no debug session is open', () => {
      renderCell()

      fireEvent.click(screen.getByText('TANK_LEVEL'))

      expect(screen.queryByRole('textbox')).not.toBeNull()
    })

    it('should open no input when clicked while the debugger is open', () => {
      renderCell()

      openDebugSession()
      fireEvent.click(screen.getByText('TANK_LEVEL'))

      expect(screen.queryByRole('textbox')).toBeNull()
    })

    it('should show the not-allowed cursor while the debugger is open', () => {
      renderCell()

      openDebugSession()

      expect(screen.getByText('TANK_LEVEL').parentElement?.className).toContain('cursor-not-allowed')
    })
  })

  describe('GenericSelectCell', () => {
    const renderCell = () =>
      render(
        <GenericSelectCell
          value='BOOL'
          onValueChange={() => undefined}
          selectValues={[
            { id: 'bool', value: 'BOOL' },
            { id: 'int', value: 'INT' },
          ]}
        />,
      )

    it('should leave the select usable while no debug session is open', () => {
      renderCell()

      expect(screen.getByLabelText<HTMLButtonElement>('generic-table-select').disabled).toBe(false)
    })

    it('should disable the select while the debugger is open', () => {
      renderCell()

      openDebugSession()

      expect(screen.getByLabelText<HTMLButtonElement>('generic-table-select').disabled).toBe(true)
    })
  })

  describe('GenericComboboxCell', () => {
    const renderCell = () =>
      render(
        <GenericComboboxCell
          value='%QX0.0'
          onValueChange={() => undefined}
          selectValues={[{ id: 'a', value: '%QX0.0' }]}
        />,
      )

    it('should leave the combobox usable while no debug session is open', () => {
      renderCell()

      expect(screen.getByRole<HTMLButtonElement>('button').disabled).toBe(false)
    })

    it('should disable the combobox while the debugger is open', () => {
      renderCell()

      openDebugSession()

      expect(screen.getByRole<HTMLButtonElement>('button').disabled).toBe(true)
    })
  })

  describe('GenericButtonCell', () => {
    it('should fire its handler while no debug session is open', () => {
      const calls: string[] = []
      render(<GenericButtonCell value='Edit' onClick={() => calls.push('click')} />)

      fireEvent.click(screen.getByRole('button'))

      expect(calls).toHaveLength(1)
    })

    it('should fire no handler while the debugger is open', () => {
      const calls: string[] = []
      render(<GenericButtonCell value='Edit' onClick={() => calls.push('click')} />)

      openDebugSession()
      fireEvent.click(screen.getByRole('button'))

      expect(calls).toHaveLength(0)
    })

    it('should disable the button while the debugger is open', () => {
      render(<GenericButtonCell value='Edit' onClick={() => undefined} />)

      openDebugSession()

      expect(screen.getByRole<HTMLButtonElement>('button').disabled).toBe(true)
    })
  })
})
