import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { ModalSlice, ModalTypes } from './types'

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
  'confirm-delete-project',
  'confirm-device-switch',
  'quit-application',
  'runtime-create-user',
  'runtime-discover-devices',
  'runtime-login',
  'server-ip-mismatch',
  'runtime-connection-lost',
  'debugger-message',
  'debugger-ip-input',
  'missing-libraries',
  'public-catalog-browser',
  'confirm-install-libraries',
  'project-readme',
]

function createDefaultModals() {
  const modals = {} as ModalSlice['modals']
  for (const type of ALL_MODAL_TYPES) {
    modals[type] = { open: false, data: null }
  }
  return modals
}

const createModalSlice: StateCreator<ModalSlice, [], [], ModalSlice> = (setState, getState) => ({
  modals: createDefaultModals(),

  modalActions: {
    openModal: (modal, data) => {
      setState(
        produce(({ modals }: ModalSlice) => {
          modals[modal] = { open: true, data }
        }),
      )
    },

    onOpenChange: (modal, value) => {
      setState(
        produce(({ modals }: ModalSlice) => {
          modals[modal] = {
            open: value,
            data: value ? modals[modal]?.data : null,
          }
        }),
      )
    },

    closeModal: () => {
      setState(
        produce(({ modals }: ModalSlice) => {
          for (const modal of ALL_MODAL_TYPES) {
            modals[modal] = { open: false, data: null }
          }
        }),
      )
    },

    getModalState: (modal) => {
      return getState().modals[modal] || { open: false }
    },
  },
})

export { createModalSlice }
