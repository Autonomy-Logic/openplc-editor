import type { PLCVariable, VariableClass } from '../../../../middleware/shared/ports/types'

// ---------------------------------------------------------------------------
// Modal types — superset of both editor and web
// ---------------------------------------------------------------------------

export type ModalTypes =
  | 'ai-consent'
  | 'block-ladder-element'
  | 'coil-ladder-element'
  | 'contact-ladder-element'
  /** Expanded ST editor for an Execute ("ST Block") element. Data
   *  shape: the React Flow node. Opens on double-click or the node's
   *  expand button, and — unlike the other graphical element modals —
   *  also opens during a debug session, read-only, so the user can
   *  read the running snippet with live value badges. */
  | 'execute-ladder-element'
  | 'execute-fbd-element'
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
  /** Confirm-overwrite gate for the File → "Import PLCopen XML" menu
   *  item. Acts on whatever project is currently open — no targeted
   *  data payload (unlike `confirm-delete-project`). */
  | 'confirm-plcopen-import'
  /** "Add variable" on a GENERIC block pin (`ANY`, `ANY_NUM`, …) in a
   *  graphical editor: the pin doesn't dictate a type, so the user
   *  confirms name / class / type instead of the editor guessing
   *  (issue #479). Data shape: `CreateGraphicalVariableModalData` —
   *  carries the pin type, the suggested values and an `onConfirm`
   *  the caller uses to create + bind the variable. */
  | 'create-graphical-variable'

/**
 * Payload of the `create-graphical-variable` modal. Lives here so the graphical
 * editors (`_atoms`) and the modal (`_organisms`) share one contract without
 * importing across the atomic-design grain.
 *
 * `onConfirm` keeps creation + node binding with the caller: each editor
 * already knows how to bind a variable into its own graph.
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
  /**
   * Undo the box's provisional state. Opening the dialog blurs the box, which
   * binds the typed text as a raw (unresolved) reference — abandoning the
   * dialog must not leave that behind.
   */
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
