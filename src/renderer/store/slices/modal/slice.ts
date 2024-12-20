import { produce } from 'immer'
import { string } from 'zod'
import { StateCreator } from 'zustand'

import { ModalSlice, ModalTypes } from './types'

const createModalSlice: StateCreator<ModalSlice, [], [], ModalSlice> = (setState, getState) => ({
  modals: {
    'block-ladder-element': {
      open: false,
      data: null,
    },
    'coil-ladder-element': {
      open: false,
      data: null,
    },
    'contact-ladder-element': {
      open: false,
      data: null,
    },

    'create-project': {
      open: false,
      data: null,
    },
    'save-changes-project': {
      open: false,
      data: string,
    },
    'confirm-delete-element': {
      open: false,
      data: null,
    },
  },

  modalActions: {
    openModal: (modal, data) => {
      setState(
        produce(({ modals }: ModalSlice) => {
          modals[modal] = {
            open: true,
            data,
          }
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
          Object.keys(modals).forEach((modal) => {
            modals[modal as ModalTypes] = {
              open: false,
              data: null,
            }
          })
        }),
      )
    },

    getModalState: (modal) => {
      return getState().modals[modal] || { open: false }
    },
  },
})

export { createModalSlice }
