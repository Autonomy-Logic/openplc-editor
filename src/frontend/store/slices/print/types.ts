export type PaperSize = 'a4' | 'a3' | 'letter' | 'legal'
export type Orientation = 'portrait' | 'landscape'

export type PageMargins = {
  top: number
  right: number
  bottom: number
  left: number
}

export type PageSetup = {
  size: PaperSize
  orientation: Orientation
  margins: PageMargins
}

export type PrintRenderMode = 'normal' | 'scale-to-fit'

/** Whether each selected POU starts a new page, or consecutive POUs may
 *  share a page when their content is short (BR09). */
export type PagePolicy = 'new-page-per-pou' | 'may-share-page'

export type PrintState = {
  print: {
    /** POUs are keyed by name, not id — `PLCPou` has no id field. */
    selectedPouNames: string[]
    renderMode: PrintRenderMode
    pagePolicy: PagePolicy
    pageSetup: PageSetup
  }
}

export type PrintActions = {
  togglePou: (name: string) => void
  selectAllPous: (names: string[]) => void
  clearPouSelection: () => void
  setRenderMode: (renderMode: PrintRenderMode) => void
  setPagePolicy: (pagePolicy: PagePolicy) => void
  setPageSetup: (patch: Partial<PageSetup>) => void
  /** Resets the whole slice (selection, render mode, page policy, page
   *  setup) to its initial defaults — session-scoped per ASM01, so this
   *  is what keeps a later export from starting off a stale selection
   *  left over from a previous project or a previous wizard run. */
  resetPrintSelection: () => void
}

export type PrintSlice = PrintState & {
  printActions: PrintActions
}
