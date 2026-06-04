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
  /** Start-screen 3-dot menu confirmation for deleting a recent
   *  project's directory from disk. Data shape: `{ projectName,
   *  projectPath }`. The "Remove from list" sibling action runs
   *  immediately without a modal — disk is untouched there. */
  | 'confirm-delete-project'
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
  /** Browse the autonomy-edge public library catalog.  Replaces the
   *  "Coming Soon" placeholder in the Library Manager's System tab.
   *  Multi-select; the install confirmation pops up on top. */
  | 'public-catalog-browser'
  /** Confirmation step chained off `public-catalog-browser` — lists
   *  the user's selection and runs the install on confirm. */
  | 'confirm-install-libraries'
  /** Project README viewer/editor — GitHub-style edit/preview tabs +
   *  commit-message override.  Available only when the project port
   *  exposes the README slot (web adapter against the Edge API). */
  | 'project-readme'

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
