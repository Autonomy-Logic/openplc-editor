// ---------------------------------------------------------------------------
// Modal types — superset of both editor and web
// ---------------------------------------------------------------------------

export type ModalTypes =
  | 'ai-consent'
  | 'block-ladder-element'
  | 'coil-ladder-element'
  | 'contact-ladder-element'
  | 'block-fbd-element'
  | 'create-project'
  | 'save-changes-project'
  | 'save-changes-file'
  | 'confirm-delete-element'
  | 'confirm-device-switch'
  | 'quit-application'
  | 'runtime-create-user'
  | 'runtime-discover-devices'
  | 'runtime-login'
  | 'server-ip-mismatch'
  | 'runtime-connection-lost'
  | 'debugger-message'
  | 'debugger-ip-input'
  | 'missing-libraries'

export type ModalsState = Record<ModalTypes, { open: boolean; data: unknown }>

export type ModalActions = {
  openModal: (modal: ModalTypes, data?: unknown) => void
  onOpenChange: (modal: ModalTypes, value: boolean) => void
  closeModal: () => void
  getModalState: (modal: ModalTypes) => { open: boolean; data?: unknown }
}

export type ModalSlice = {
  modals: ModalsState
  modalActions: ModalActions
}
