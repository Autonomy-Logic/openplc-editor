import type { Node } from '@xyflow/react'

import type { PLCVariable, VariableClass } from '../../../../middleware/shared/ports/types'

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
  | 'retrieve-project'
  | 'runtime-login'
  | 'server-ip-mismatch'
  | 'runtime-connection-lost'
  | 'debugger-message'
  | 'debugger-ip-input'
  | 'missing-libraries'
  /** Browses the autonomy-edge public library catalog with multi-select; the install confirmation opens on top. */
  | 'public-catalog-browser'
  /** Confirmation step chained off `public-catalog-browser` — lists
   *  the user's selection and runs the install on confirm. */
  | 'confirm-install-libraries'
  /** Project README viewer/editor — GitHub-style edit/preview tabs +
   *  commit-message override.  Available only when the project port
   *  exposes the README slot (web adapter against the Edge API). */
  | 'project-readme'
  /** Confirm-overwrite gate for the File → "Import PLCopen XML" menu
   *  item. Acts on whatever project is currently open — no targeted
   *  data payload (unlike `confirm-delete-project`). */
  | 'confirm-plcopen-import'
  /** "Add variable" on a generic block pin (`ANY`, `ANY_NUM`, …) of a graphical editor, where the user
   *  picks name, class and type. Data shape: `CreateGraphicalVariableModalData`. */
  | 'create-graphical-variable'
  /** File > Print / Preview wizard: select POUs, choose render mode
   *  and page policy, preview, export. Preview is an alias into this
   *  same modal, not a separate flow. */
  | 'export-pdf'
  /** Standalone File > Page Setup entry — same fields as the export
   *  wizard's options step, reachable without starting an export. */
  | 'page-setup'

/** Payload of the `create-graphical-variable` modal; `onConfirm` creates the variable and binds it to the node. */
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
  /** Undoes the box's provisional state: the raw reference bound to the typed text when the dialog opened. */
  onCancel?: () => void
}

/** Payload of the graphical element dialogs: the node and the POU whose editor owns it. */
export type GraphicalElementModalData = { pouName: string; node: Node }

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
