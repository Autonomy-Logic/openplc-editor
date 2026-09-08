/**
 * Print / export-to-PDF request contract — the shape `ProjectPort.renderPdf`
 * accepts. Lives in `ports` (not `backend/shared/print`, where the render
 * engine that consumes it lives) because the request is built on the main
 * thread by `frontend/services/print-actions.ts`, which cannot depend on
 * `backend-shared`. `backend/shared/print/types.ts` re-exports these names
 * so the engine's own call sites are unaffected.
 */

import type { FBDRungState, RungLadderState, VariableClass, VariableFlag } from './types'

// ---------------------------------------------------------------------------
// Page setup
// ---------------------------------------------------------------------------

export type PaperSize = 'a4' | 'a3' | 'letter' | 'legal'
export type PageOrientation = 'portrait' | 'landscape'

export type PageMarginsPt = {
  top: number
  right: number
  bottom: number
  left: number
}

export type PrintPageSetup = {
  size: PaperSize
  orientation: PageOrientation
  marginsPt: PageMarginsPt
}

// ---------------------------------------------------------------------------
// Render mode / page policy
// ---------------------------------------------------------------------------

export type PrintRenderMode = 'normal' | 'scale-to-fit'
export type PagePolicy = 'new-page-per-pou' | 'may-share-page'

// ---------------------------------------------------------------------------
// Variables table
// ---------------------------------------------------------------------------

/** Pre-formatted for print — `type`/`initialValue` are already display strings. */
export type PrintVar = {
  name: string
  varClass: VariableClass | ''
  flag: VariableFlag | ''
  type: string
  location: string
  initialValue: string
  documentation: string
  debug: boolean
}

// ---------------------------------------------------------------------------
// Colorized text (ST / IL / C++ / Python)
// ---------------------------------------------------------------------------

export type TextRun = {
  text: string
  color: string
  bold?: boolean
  /** No italic mono face is embedded — text-renderer.ts renders italic runs upright. */
  italic?: boolean
}

export type ColoredLine = {
  runs: TextRun[]
}

export type PrintTextKind = 'st' | 'il' | 'cpp' | 'python'

// ---------------------------------------------------------------------------
// POUs
// ---------------------------------------------------------------------------

export type PrintPou =
  | { name: string; kind: 'ld'; rungs: RungLadderState[]; variables: PrintVar[] }
  | { name: string; kind: 'fbd'; rung: FBDRungState; variables: PrintVar[] }
  | { name: string; kind: PrintTextKind; lines: ColoredLine[]; variables: PrintVar[] }

export type PrintRequest = {
  projectName: string
  mode: PrintRenderMode
  pagePolicy: PagePolicy
  page: PrintPageSetup
  pous: PrintPou[]
}
