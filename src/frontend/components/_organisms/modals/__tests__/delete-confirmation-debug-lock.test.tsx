import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import { act, fireEvent, render, screen } from '@testing-library/react'

import type { OpenPLCStore } from '@root/frontend/store'

import { ConfirmDeleteElementModal } from '../delete-confirmation-modal'

let store: OpenPLCStore

const openDebugSession = () =>
  act(() => {
    store.getState().workspaceActions.setDebuggerVisible(true)
  })

const closeDebugSession = () =>
  act(() => {
    store.getState().workspaceActions.clearDebugState()
  })

const pouNames = () => store.getState().project.data.pous.map((pou) => pou.name)

const openDeleteConfirmation = () => {
  store = createTestStore()
  act(() => {
    store.getState().pouActions.create({
      type: 'program',
      name: 'doomed',
      language: 'st',
    })
    store.getState().modalActions.openModal('confirm-delete-element', { name: 'doomed', elementType: 'pou' })
  })
  render(<ConfirmDeleteElementModal isOpen />, { wrapper: createStoreWrapper(store) })
}

const confirmDelete = () => fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))

describe('the delete confirmation during a debug session', () => {
  it('should delete the element while no debug session is open', () => {
    openDeleteConfirmation()

    confirmDelete()

    expect(pouNames()).not.toContain('doomed')
  })

  it('should delete nothing when the confirmation is confirmed after the session starts', () => {
    openDeleteConfirmation()

    openDebugSession()
    confirmDelete()

    expect(pouNames()).toContain('doomed')
  })

  it('should delete the element again once the debug session is closed', () => {
    openDeleteConfirmation()

    openDebugSession()
    closeDebugSession()
    confirmDelete()

    expect(pouNames()).not.toContain('doomed')
  })
})
