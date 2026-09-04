// `@pdf-lib/fontkit`'s ESM build (dist/fontkit.es.js) does `export default
// fontkit` with no named exports — a namespace import binds only `.default`,
// leaving `fontkit.create` undefined at runtime under Vite/Rollup's ESM
// resolution (CJS `require`, which every non-browser test runner uses instead,
// masks this: there the whole module IS the object with `.create` on it).
import fontkit from '@pdf-lib/fontkit'
import {
  clip,
  endPath,
  PDFDocument,
  type PDFFont,
  type PDFPage,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
} from 'pdf-lib'

import type { DrawOp, EmbeddedFontSet, PdfPageContent, PrintFontKey, RgbHex } from './types'

type Rgb = { r: number; g: number; b: number }

function hexToRgb(hex: RgbHex): Rgb {
  const clean = hex.replace('#', '')
  return {
    r: parseInt(clean.slice(0, 2), 16) / 255,
    g: parseInt(clean.slice(2, 4), 16) / 255,
    b: parseInt(clean.slice(4, 6), 16) / 255,
  }
}

type StrokeFillOptions = { stroke?: Rgb; strokeWidthPt?: number; fill?: Rgb }

/**
 * Turns device-independent `DrawOp`s into pdf-lib calls. Injected so
 * `paginate.ts`'s output can be verified with a call-recording fake, without
 * pulling pdf-lib into every renderer test.
 */
export interface PdfBackend {
  addPage(widthPt: number, heightPt: number): void
  drawLine(x1: number, y1: number, x2: number, y2: number, color: Rgb, widthPt: number): void
  drawRect(x: number, y: number, width: number, height: number, opts: StrokeFillOptions): void
  drawSvgPath(d: string, x: number, y: number, scale: number, opts: StrokeFillOptions): void
  drawText(
    text: string,
    x: number,
    y: number,
    sizePt: number,
    color: Rgb,
    font: PrintFontKey,
    align: 'left' | 'center' | 'right',
  ): void
  clipPush(x: number, y: number, width: number, height: number): void
  clipPop(): void
  finish(): Promise<Uint8Array>
}

/**
 * Every DrawOp coordinate is top-down (y grows downward), page-relative.
 * pdf-lib's page space is bottom-up — this is the one place that flips.
 */
export async function createPdfLibBackend(fonts: EmbeddedFontSet): Promise<PdfBackend> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)

  // Known limitation: Noto Sans's embedded coverage is Latin — a POU or
  // variable name using CJK, emoji, or other glyphs outside it renders those
  // characters blank rather than throwing (verified in index.test.ts). No
  // fallback font is bundled; widening coverage is a real feature, not a bug.
  const embedded: Record<PrintFontKey, PDFFont> = {
    sans: await doc.embedFont(fonts.sans, { subset: true }),
    sansBold: await doc.embedFont(fonts.sansBold, { subset: true }),
    mono: await doc.embedFont(fonts.mono, { subset: true }),
    monoBold: await doc.embedFont(fonts.monoBold, { subset: true }),
  }

  let page: PDFPage | undefined
  let pageHeightPt = 0

  function currentPage(): PDFPage {
    if (!page) throw new Error('pdf-writer: drawing op received before any page was added')
    return page
  }

  return {
    addPage(widthPt, heightPt) {
      page = doc.addPage([widthPt, heightPt])
      pageHeightPt = heightPt
    },

    drawLine(x1, y1, x2, y2, color, widthPt) {
      currentPage().drawLine({
        start: { x: x1, y: pageHeightPt - y1 },
        end: { x: x2, y: pageHeightPt - y2 },
        thickness: widthPt,
        color: rgb(color.r, color.g, color.b),
      })
    },

    drawRect(x, y, width, height, opts) {
      currentPage().drawRectangle({
        x,
        y: pageHeightPt - y - height,
        width,
        height,
        ...(opts.fill ? { color: rgb(opts.fill.r, opts.fill.g, opts.fill.b) } : {}),
        ...(opts.stroke
          ? { borderColor: rgb(opts.stroke.r, opts.stroke.g, opts.stroke.b), borderWidth: opts.strokeWidthPt ?? 1 }
          : {}),
      })
    },

    drawSvgPath(d, x, y, scale, opts) {
      currentPage().drawSvgPath(d, {
        x,
        y: pageHeightPt - y,
        scale,
        ...(opts.fill ? { color: rgb(opts.fill.r, opts.fill.g, opts.fill.b) } : {}),
        ...(opts.stroke
          ? { borderColor: rgb(opts.stroke.r, opts.stroke.g, opts.stroke.b), borderWidth: opts.strokeWidthPt ?? 1 }
          : {}),
      })
    },

    drawText(text, x, y, sizePt, color, font, align) {
      const pdfFont = embedded[font]
      const width = align === 'left' ? 0 : pdfFont.widthOfTextAtSize(text, sizePt)
      const dx = align === 'center' ? -width / 2 : align === 'right' ? -width : 0
      currentPage().drawText(text, {
        x: x + dx,
        y: pageHeightPt - y,
        size: sizePt,
        font: pdfFont,
        color: rgb(color.r, color.g, color.b),
      })
    },

    clipPush(x, y, width, height) {
      currentPage().pushOperators(
        pushGraphicsState(),
        rectangle(x, pageHeightPt - y - height, width, height),
        clip(),
        endPath(),
      )
    },

    clipPop() {
      currentPage().pushOperators(popGraphicsState())
    },

    finish() {
      return doc.save()
    },
  }
}

function drawOp(backend: PdfBackend, op: DrawOp): void {
  switch (op.kind) {
    case 'line':
      backend.drawLine(op.x1, op.y1, op.x2, op.y2, hexToRgb(op.color), op.widthPt)
      return
    case 'rect':
      backend.drawRect(op.x, op.y, op.width, op.height, {
        stroke: op.stroke ? hexToRgb(op.stroke) : undefined,
        strokeWidthPt: op.strokeWidthPt,
        fill: op.fill ? hexToRgb(op.fill) : undefined,
      })
      return
    case 'path':
      backend.drawSvgPath(op.d, op.x, op.y, op.scale ?? 1, {
        stroke: op.stroke ? hexToRgb(op.stroke) : undefined,
        strokeWidthPt: op.strokeWidthPt,
        fill: op.fill ? hexToRgb(op.fill) : undefined,
      })
      return
    case 'text':
      backend.drawText(op.text, op.x, op.y, op.sizePt, hexToRgb(op.color), op.font, op.align ?? 'left')
      return
    case 'clipPush':
      backend.clipPush(op.x, op.y, op.width, op.height)
      return
    case 'clipPop':
      backend.clipPop()
      return
    default: {
      const exhaustive: never = op
      return exhaustive
    }
  }
}

export function drawPages(backend: PdfBackend, pages: PdfPageContent[]): void {
  for (const page of pages) {
    backend.addPage(page.widthPt, page.heightPt)
    for (const op of page.ops) drawOp(backend, op)
  }
}
