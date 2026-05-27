import { createStore } from 'zustand/vanilla'

import { createModalSlice } from '../slices/modal/slice'
import type { ModalSlice, ModalTypes } from '../slices/modal/types'

function makeStore() {
  return createStore<ModalSlice>()(createModalSlice)
}

const ALL_MODAL_TYPES: ModalTypes[] = [
  'ai-consent',
  'block-ladder-element',
  'coil-ladder-element',
  'contact-ladder-element',
  'block-fbd-element',
  'create-project',
  'save-changes-project',
  'save-changes-file',
  'confirm-delete-element',
  'confirm-device-switch',
  'quit-application',
  'runtime-create-user',
  'runtime-discover-devices',
  'runtime-login',
  'server-ip-mismatch',
  'runtime-connection-lost',
  'debugger-message',
  'debugger-ip-input',
]

describe('createModalSlice', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => {
    store = makeStore()
  })

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------
  it('should initialize all modals as closed with null data', () => {
    const { modals } = store.getState()
    for (const modalType of ALL_MODAL_TYPES) {
      expect(modals[modalType]).toEqual({ open: false, data: null })
    }
  })

  // -------------------------------------------------------------------------
  // openModal
  // -------------------------------------------------------------------------
  it('openModal opens a modal with data', () => {
    store.getState().modalActions.openModal('create-project', { name: 'test' })
    const modal = store.getState().modals['create-project']
    expect(modal.open).toBe(true)
    expect(modal.data).toEqual({ name: 'test' })
  })

  it('openModal opens a modal without data', () => {
    store.getState().modalActions.openModal('quit-application')
    const modal = store.getState().modals['quit-application']
    expect(modal.open).toBe(true)
    expect(modal.data).toBeUndefined()
  })

  // -------------------------------------------------------------------------
  // onOpenChange
  // -------------------------------------------------------------------------
  it('onOpenChange sets modal open and preserves data when value is true', () => {
    store.getState().modalActions.openModal('debugger-message', { msg: 'hello' })
    store.getState().modalActions.onOpenChange('debugger-message', true)

    const modal = store.getState().modals['debugger-message']
    expect(modal.open).toBe(true)
    expect(modal.data).toEqual({ msg: 'hello' })
  })

  it('onOpenChange sets modal closed and clears data when value is false', () => {
    store.getState().modalActions.openModal('debugger-message', { msg: 'hello' })
    store.getState().modalActions.onOpenChange('debugger-message', false)

    const modal = store.getState().modals['debugger-message']
    expect(modal.open).toBe(false)
    expect(modal.data).toBeNull()
  })

  it('onOpenChange handles modal with no prior data when value is true', () => {
    store.getState().modalActions.onOpenChange('ai-consent', true)
    const modal = store.getState().modals['ai-consent']
    expect(modal.open).toBe(true)
    expect(modal.data).toBeNull()
  })

  // -------------------------------------------------------------------------
  // closeModal
  // -------------------------------------------------------------------------
  it('closeModal closes all modals', () => {
    store.getState().modalActions.openModal('create-project', { name: 'test' })
    store.getState().modalActions.openModal('quit-application', 'data')
    store.getState().modalActions.openModal('debugger-ip-input')

    store.getState().modalActions.closeModal()

    const { modals } = store.getState()
    for (const modalType of ALL_MODAL_TYPES) {
      expect(modals[modalType]).toEqual({ open: false, data: null })
    }
  })

  // -------------------------------------------------------------------------
  // getModalState
  // -------------------------------------------------------------------------
  it('getModalState returns current state of a modal', () => {
    store.getState().modalActions.openModal('runtime-login', { user: 'admin' })
    const state = store.getState().modalActions.getModalState('runtime-login')
    expect(state.open).toBe(true)
    expect(state.data).toEqual({ user: 'admin' })
  })

  it('getModalState returns default for a modal that exists but is closed', () => {
    const state = store.getState().modalActions.getModalState('ai-consent')
    expect(state.open).toBe(false)
    expect(state.data).toBeNull()
  })

  it('getModalState returns fallback for unknown modal key', () => {
    // Casting to ModalTypes to test the fallback branch for a missing key
    const state = store.getState().modalActions.getModalState('nonexistent-modal' as ModalTypes)
    expect(state.open).toBe(false)
  })
})
