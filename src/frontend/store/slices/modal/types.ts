import type { PLCVariable, VariableClass } from '../../../../middleware/shared/ports/types'

// Modal types, a superset of both editor and web.

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
  /**
   * Start-screen confirmation for deleting a recent project's directory from disk. Data shape: `{ projectName,
   * projectPath }`.
   */
  | 'confirm-delete-project'
  | 'confirm-device-switch'
  | 'quit-application'
  | 'runtime-create-user'
  | 'runtime-discover-devices'
  | 'retrieve-project'
  | 'runtime-login'
  | 'runtime-no-device'
  | 'server-ip-mismatch'
  | 'runtime-connection-lost'
  | 'debugger-message'
  | 'debugger-ip-input'
  | 'missing-libraries'
  /** Browse the autonomy-edge public library catalog, with multi-select. */
  | 'public-catalog-browser'
  /** Confirmation step chained off `public-catalog-browser` — lists
   *  the user's selection and runs the install on confirm. */
  | 'confirm-install-libraries'
  /** Project README viewer/editor with edit/preview tabs and a commit-message override. */
  | 'project-readme'
  /** Confirm-overwrite gate for the File → "Import PLCopen XML" menu
   *  item. Acts on whatever project is currently open — no targeted
   *  data payload (unlike `confirm-delete-project`). */
  | 'confirm-plcopen-import'
  /**
   * "Add variable" on a GENERIC block pin (`ANY`, `ANY_NUM`, …) in a graphical editor. Data shape:
   * `CreateGraphicalVariableModalData`.
   */
  | 'create-graphical-variable'
  /** File > Print / Preview wizard: select POUs, choose render mode
   *  and page policy, preview, export. Preview is an alias into this
   *  same modal, not a separate flow. */
  | 'export-pdf'
  /** Standalone File > Page Setup entry — same fields as the export
   *  wizard's options step, reachable without starting an export. */
  | 'page-setup'

/**
 * Payload of the `create-graphical-variable` modal. `onConfirm` creates and binds the variable on the caller's side.
 */
export type CreateGraphicalVariableModalData = {
  /** Declared type of the pin the box sits on (e.g. `ANY`, `ANY_NUM`). */
  pinType: string
  /** Name the user typed into the box. */
  name: string
  /** Type the editor inferred from the block's bound pins — the pre-selection. */
  suggestedType: { definition: PLCVariable['type']['definition']; value: string }
  onConfirm: (choice: {
    name: string
    class: VariableClass
    type: { definition: PLCVariable['type']['definition']; value: string }
  }) => void
  /** Undo the box's provisional state when the dialog is abandoned. */
  onCancel?: () => void
}

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
