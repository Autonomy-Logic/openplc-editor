import { lineHeightPt, monoCharWidthPt, textAscentPt } from './geometry'
import type { ColoredLine, ContentBlock, DrawOp, PrintFontKey, PrintRenderMode, TextRun } from './types'

const NORMAL_FONT_SIZE_PT = 9
const SCALE_TO_FIT_MIN_PT = 3
const SCALE_TO_FIT_MAX_PT = 9
const SCALE_TO_FIT_STEP_PT = 0.25

function fontFor(bold: boolean | undefined): PrintFontKey {
  return bold ? 'monoBold' : 'mono'
}

/** Splits one source line's runs into as many `cols`-wide wrapped rows as needed, preserving run boundaries mid-wrap. */
export function wrapColoredLine(line: ColoredLine, cols: number): TextRun[][] {
  const width = Math.max(1, cols)
  const wrapped: TextRun[][] = []
  let current: TextRun[] = []
  let currentLen = 0

  for (const run of line.runs) {
    let remaining = run.text
    while (remaining.length > 0) {
      const space = width - currentLen
      if (space <= 0) {
        wrapped.push(current)
        current = []
        currentLen = 0
        continue
      }
      const chunk = remaining.slice(0, space)
      current.push({ ...run, text: chunk })
      currentLen += chunk.length
      remaining = remaining.slice(chunk.length)
    }
  }
  wrapped.push(current)
  return wrapped
}

function wrapAll(lines: ColoredLine[], cols: number): TextRun[][] {
  return lines.flatMap((line) => wrapColoredLine(line, cols))
}

function colsForWidth(contentWidthPt: number, fontSizePt: number): number {
  return Math.max(1, Math.floor(contentWidthPt / monoCharWidthPt(fontSizePt)))
}

function wrappedLineCount(lines: ColoredLine[], contentWidthPt: number, fontSizePt: number): number {
  const cols = colsForWidth(contentWidthPt, fontSizePt)
  return lines.reduce((sum, line) => sum + wrapColoredLine(line, cols).length, 0)
}

function fitsOnePage(
  lines: ColoredLine[],
  fontSizePt: number,
  contentWidthPt: number,
  contentHeightPt: number,
): boolean {
  return wrappedLineCount(lines, contentWidthPt, fontSizePt) * lineHeightPt(fontSizePt) <= contentHeightPt
}

/** Largest font size in `[3, 9]` (0.25pt steps) whose wrapped text still fits one page; `fitsOnePage` is monotone in size. */
function findScaleToFitFontSize(lines: ColoredLine[], contentWidthPt: number, contentHeightPt: number): number {
  const steps = Math.round((SCALE_TO_FIT_MAX_PT - SCALE_TO_FIT_MIN_PT) / SCALE_TO_FIT_STEP_PT)
  let lo = 0
  let hi = steps
  let best = 0
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    const fontSizePt = SCALE_TO_FIT_MIN_PT + mid * SCALE_TO_FIT_STEP_PT
    if (fitsOnePage(lines, fontSizePt, contentWidthPt, contentHeightPt)) {
      best = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return SCALE_TO_FIT_MIN_PT + best * SCALE_TO_FIT_STEP_PT
}

function linesToOps(wrappedLines: TextRun[][], fontSizePt: number): DrawOp[] {
  const charWidth = monoCharWidthPt(fontSizePt)
  const lineHeight = lineHeightPt(fontSizePt)
  const ascent = textAscentPt(fontSizePt)
  const ops: DrawOp[] = []

  wrappedLines.forEach((runs, i) => {
    const baselineY = i * lineHeight + ascent
    let col = 0
    for (const run of runs) {
      if (run.text.length > 0) {
        ops.push({
          kind: 'text',
          text: run.text,
          x: col * charWidth,
          y: baselineY,
          sizePt: fontSizePt,
          color: run.color,
          font: fontFor(run.bold),
        })
      }
      col += run.text.length
    }
  })
  return ops
}

function chunkedBlocks(
  lines: ColoredLine[],
  fontSizePt: number,
  contentWidthPt: number,
  contentHeightPt: number,
): ContentBlock[] {
  const cols = colsForWidth(contentWidthPt, fontSizePt)
  const wrapped = wrapAll(lines, cols)
  const lineHeight = lineHeightPt(fontSizePt)
  const linesPerPage = Math.max(1, Math.floor(contentHeightPt / lineHeight))

  const blocks: ContentBlock[] = []
  for (let start = 0; start < wrapped.length; start += linesPerPage) {
    const chunk = wrapped.slice(start, start + linesPerPage)
    blocks.push({ widthPt: contentWidthPt, heightPt: chunk.length * lineHeight, ops: linesToOps(chunk, fontSizePt) })
  }
  return blocks
}

function singleBlock(lines: ColoredLine[], fontSizePt: number, contentWidthPt: number): ContentBlock {
  const cols = colsForWidth(contentWidthPt, fontSizePt)
  const wrapped = wrapAll(lines, cols)
  return {
    widthPt: contentWidthPt,
    heightPt: wrapped.length * lineHeightPt(fontSizePt),
    ops: linesToOps(wrapped, fontSizePt),
  }
}

/**
 * `lines -> ContentBlock[]` for ST/IL/C++/Python. Normal = fixed 9pt hard-wrap,
 * chunked to page-sized blocks. Scale-to-fit = largest font in [3,9]pt that
 * still fits one page; falls back to page-chunking at 3pt if even that overflows.
 */
export function renderTextPou(
  lines: ColoredLine[],
  mode: PrintRenderMode,
  contentWidthPt: number,
  contentHeightPt: number,
): ContentBlock[] {
  if (lines.length === 0) return []

  if (mode === 'normal') {
    return chunkedBlocks(lines, NORMAL_FONT_SIZE_PT, contentWidthPt, contentHeightPt)
  }

  const fontSizePt = findScaleToFitFontSize(lines, contentWidthPt, contentHeightPt)
  if (fitsOnePage(lines, fontSizePt, contentWidthPt, contentHeightPt)) {
    return [singleBlock(lines, fontSizePt, contentWidthPt)]
  }
  return chunkedBlocks(lines, fontSizePt, contentWidthPt, contentHeightPt)
}
