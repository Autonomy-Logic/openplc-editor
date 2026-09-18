/**
 * The request contract (page setup, render mode, POU payloads) lives in
 * `middleware/shared/ports/print-types.ts` — `ProjectPort.renderPdf`'s
 * parameter type — since `frontend/services/print-actions.ts` builds it and
 * cannot depend on `backend-shared`. Re-exported here so every other module
 * in this engine can keep importing from `./types` as before.
 */
export type {
  ColoredLine,
  PageMarginsPt,
  PageOrientation,
  PagePolicy,
  PaperSize,
  PrintPageSetup,
  PrintPou,
  PrintRenderMode,
  PrintRequest,
  PrintTextKind,
  PrintVar,
  TextRun,
} from '@root/middleware/shared/ports/print-types'

// ---------------------------------------------------------------------------
// Draw ops — device-independent drawing instructions, in points, in a
// top-down (y grows downward) page-content coordinate space. pdf-writer.ts
// is the only place that flips into pdf-lib's bottom-up page space.
// ---------------------------------------------------------------------------

export type RgbHex = string

export type PrintFontKey = 'sans' | 'sansBold' | 'mono' | 'monoBold'

export type DrawOp =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; color: RgbHex; widthPt: number }
  | {
      kind: 'rect'
      x: number
      y: number
      width: number
      height: number
      stroke?: RgbHex
      strokeWidthPt?: number
      fill?: RgbHex
    }
  | {
      kind: 'path'
      d: string
      x: number
      y: number
      scale?: number
      stroke?: RgbHex
      strokeWidthPt?: number
      fill?: RgbHex
    }
  | {
      kind: 'text'
      text: string
      x: number
      y: number
      sizePt: number
      color: RgbHex
      font: PrintFontKey
      align?: 'left' | 'center' | 'right'
    }
  /** Pushes a rectangular clip region (page-content coordinate space) — pairs with `clipPop`. */
  | { kind: 'clipPush'; x: number; y: number; width: number; height: number }
  | { kind: 'clipPop' }

export type PdfPageContent = {
  widthPt: number
  heightPt: number
  ops: DrawOp[]
}

/**
 * A self-contained, page-content-width-scoped chunk of drawing ops, already
 * normalized to a local (0,0) top-left origin. Guaranteed to be no taller
 * than one page's content box — `paginate.ts` stacks blocks top-to-bottom,
 * starting a new page whenever the next block would overflow.
 */
export type ContentBlock = {
  widthPt: number
  heightPt: number
  ops: DrawOp[]
}

// ---------------------------------------------------------------------------
// Embedded fonts (supplied by the per-repo adapter, see pdf-writer.ts)
// ---------------------------------------------------------------------------

export type EmbeddedFontSet = {
  sans: Uint8Array
  sansBold: Uint8Array
  mono: Uint8Array
  monoBold: Uint8Array
}
