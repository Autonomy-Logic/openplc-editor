import { renderFbdPou } from './fbd-renderer'
import { resolvePageBox, transformDrawOps } from './geometry'
import { renderLadderPou } from './ladder-renderer'
import { INK_COLOR } from './symbols'
import { renderTextPou } from './text-renderer'
import type { ContentBlock, DrawOp, PdfPageContent, PrintPou, PrintRenderMode, PrintRequest } from './types'
import { renderVariablesTable } from './variables-table'

const BLOCK_GAP_PT = 8
const HEADER_HEIGHT_PT = 22

function headerBlock(pou: PrintPou, contentWidthPt: number): ContentBlock {
  const label = `${pou.name} (${pou.kind.toUpperCase()})`
  return {
    widthPt: contentWidthPt,
    heightPt: HEADER_HEIGHT_PT,
    ops: [
      { kind: 'text', text: label, x: 0, y: 13, sizePt: 12, color: INK_COLOR, font: 'sansBold', align: 'left' },
      { kind: 'line', x1: 0, y1: 19, x2: contentWidthPt, y2: 19, color: INK_COLOR, widthPt: 1 },
    ],
  }
}

function renderPouBlocks(
  pou: PrintPou,
  mode: PrintRenderMode,
  contentWidthPt: number,
  contentHeightPt: number,
): ContentBlock[] {
  let contentBlocks: ContentBlock[]
  switch (pou.kind) {
    case 'ld':
      contentBlocks = renderLadderPou(pou.rungs, mode, contentWidthPt)
      break
    case 'fbd':
      contentBlocks = renderFbdPou(pou.rung, mode, contentWidthPt, contentHeightPt)
      break
    case 'st':
    case 'il':
    case 'cpp':
    case 'python':
      contentBlocks = renderTextPou(pou.lines, mode, contentWidthPt, contentHeightPt)
      break
    default: {
      const exhaustive: never = pou
      throw new Error(`Unhandled POU kind: ${JSON.stringify(exhaustive)}`)
    }
  }

  const tableBlocks = renderVariablesTable(pou.variables, contentWidthPt, contentHeightPt)
  return [headerBlock(pou, contentWidthPt), ...contentBlocks, ...tableBlocks]
}

/**
 * Assembles every selected POU into pages: greedy top-to-bottom flow, a new
 * page whenever the next block would overflow the content box, plus a forced
 * break at each POU boundary under `new-page-per-pou`.
 */
export function paginate(req: PrintRequest): PdfPageContent[] {
  const box = resolvePageBox(req.page)
  const pages: DrawOp[][] = []
  let currentOps: DrawOp[] = []
  let currentY = 0
  let hasContent = false

  const flushPage = () => {
    pages.push(currentOps)
    currentOps = []
    currentY = 0
    hasContent = false
  }

  for (const pou of req.pous) {
    if (req.pagePolicy === 'new-page-per-pou' && hasContent) flushPage()

    const blocks = renderPouBlocks(pou, req.mode, box.contentWidthPt, box.contentHeightPt)
    for (const block of blocks) {
      if (hasContent && currentY + block.heightPt > box.contentHeightPt) flushPage()
      const transform = { dx: box.marginsPt.left, dy: box.marginsPt.top + currentY, scale: 1 }
      currentOps.push(...transformDrawOps(block.ops, transform))
      currentY += block.heightPt + BLOCK_GAP_PT
      hasContent = true
    }
  }

  if (hasContent) flushPage()
  if (pages.length === 0) flushPage()

  return pages.map((ops) => ({ widthPt: box.widthPt, heightPt: box.heightPt, ops }))
}
