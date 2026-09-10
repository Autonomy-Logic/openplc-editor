import { INK_COLOR } from './symbols'
import type { ContentBlock, DrawOp, PrintVar } from './types'

const FONT_SIZE_PT = 7
const ROW_HEIGHT_PT = 14
const HEADER_HEIGHT_PT = 16
const CELL_PADDING_PT = 3

type Align = 'left' | 'center' | 'right'
type Column = { header: string; widthFraction: number; align: Align; value: (v: PrintVar, index: number) => string }

const COLUMNS: Column[] = [
  { header: '#', widthFraction: 0.04, align: 'right', value: (_v, i) => String(i + 1) },
  { header: 'Name', widthFraction: 0.14, align: 'left', value: (v) => v.name },
  { header: 'Class', widthFraction: 0.09, align: 'left', value: (v) => v.varClass },
  { header: 'Flags', widthFraction: 0.08, align: 'left', value: (v) => v.flag },
  { header: 'Type', widthFraction: 0.15, align: 'left', value: (v) => v.type },
  { header: 'Location', widthFraction: 0.12, align: 'left', value: (v) => v.location },
  { header: 'Initial Value', widthFraction: 0.11, align: 'left', value: (v) => v.initialValue },
  { header: 'Documentation', widthFraction: 0.19, align: 'left', value: (v) => v.documentation },
  { header: 'Debug', widthFraction: 0.08, align: 'center', value: (v) => (v.debug ? 'Yes' : '') },
]

function columnBoxes(contentWidthPt: number): { x: number; width: number; column: Column }[] {
  let x = 0
  return COLUMNS.map((column) => {
    const width = column.widthFraction * contentWidthPt
    const box = { x, width, column }
    x += width
    return box
  })
}

function cellX(x: number, width: number, align: Align): number {
  if (align === 'right') return x + width - CELL_PADDING_PT
  if (align === 'center') return x + width / 2
  return x + CELL_PADDING_PT
}

function rowOps(
  columns: { x: number; width: number; column: Column }[],
  y: number,
  height: number,
  text: (c: Column) => string,
  bold: boolean,
): DrawOp[] {
  const ops: DrawOp[] = []
  const baselineY = y + height / 2 + FONT_SIZE_PT * 0.35
  for (const { x, width, column } of columns) {
    ops.push({
      kind: 'clipPush',
      x: x + CELL_PADDING_PT / 2,
      y,
      width: Math.max(0, width - CELL_PADDING_PT),
      height,
    })
    ops.push({
      kind: 'text',
      text: text(column),
      x: cellX(x, width, column.align),
      y: baselineY,
      sizePt: FONT_SIZE_PT,
      color: INK_COLOR,
      font: bold ? 'sansBold' : 'sans',
      align: column.align,
    })
    ops.push({ kind: 'clipPop' })
  }
  return ops
}

function headerBlockOps(columns: { x: number; width: number; column: Column }[], contentWidthPt: number): DrawOp[] {
  return [
    ...rowOps(columns, 0, HEADER_HEIGHT_PT, (c) => c.header, true),
    {
      kind: 'line',
      x1: 0,
      y1: HEADER_HEIGHT_PT,
      x2: contentWidthPt,
      y2: HEADER_HEIGHT_PT,
      color: INK_COLOR,
      widthPt: 0.75,
    },
  ]
}

/** `variables -> ContentBlock[]`, chunked to page-sized blocks with the header row repeated on each. */
export function renderVariablesTable(
  vars: PrintVar[],
  contentWidthPt: number,
  contentHeightPt: number,
): ContentBlock[] {
  if (vars.length === 0) return []

  const columns = columnBoxes(contentWidthPt)
  const rowsPerPage = Math.max(1, Math.floor((contentHeightPt - HEADER_HEIGHT_PT) / ROW_HEIGHT_PT))

  const blocks: ContentBlock[] = []
  for (let start = 0; start < vars.length; start += rowsPerPage) {
    const chunk = vars.slice(start, start + rowsPerPage)
    const ops: DrawOp[] = [...headerBlockOps(columns, contentWidthPt)]
    chunk.forEach((v, i) => {
      const y = HEADER_HEIGHT_PT + i * ROW_HEIGHT_PT
      ops.push(...rowOps(columns, y, ROW_HEIGHT_PT, (c) => c.value(v, start + i), false))
    })
    blocks.push({ widthPt: contentWidthPt, heightPt: HEADER_HEIGHT_PT + chunk.length * ROW_HEIGHT_PT, ops })
  }
  return blocks
}
