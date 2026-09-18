import type { ColoredLine } from '../types'
import { renderTextPou, wrapColoredLine } from '../text-renderer'

describe('wrapColoredLine', () => {
  it('returns a single row when the line fits within cols', () => {
    const line: ColoredLine = { runs: [{ text: 'ab', color: '#111111' }] }
    expect(wrapColoredLine(line, 5)).toEqual([[{ text: 'ab', color: '#111111' }]])
  })

  it('wraps a single long run into multiple rows', () => {
    const line: ColoredLine = { runs: [{ text: 'abcdefgh', color: '#111111' }] }
    const wrapped = wrapColoredLine(line, 3)
    expect(wrapped).toEqual([
      [{ text: 'abc', color: '#111111' }],
      [{ text: 'def', color: '#111111' }],
      [{ text: 'gh', color: '#111111' }],
    ])
  })

  it('carries run fields (color/bold) across a mid-run wrap and iterates multiple runs', () => {
    const line: ColoredLine = {
      runs: [
        { text: 'ab', color: '#111111' },
        { text: 'cdefgh', color: '#222222', bold: true },
      ],
    }
    const wrapped = wrapColoredLine(line, 5)
    expect(wrapped).toEqual([
      [
        { text: 'ab', color: '#111111' },
        { text: 'cde', color: '#222222', bold: true },
      ],
      [{ text: 'fgh', color: '#222222', bold: true }],
    ])
  })

  it('skips an empty run without looping (while-condition false immediately)', () => {
    const line: ColoredLine = { runs: [{ text: '', color: '#000000' }] }
    expect(wrapColoredLine(line, 5)).toEqual([[]])
  })
})

describe('renderTextPou', () => {
  it('returns [] for no lines', () => {
    expect(renderTextPou([], 'normal', 200, 200)).toEqual([])
  })

  it('normal mode: fits in a single block, bold/non-bold runs, empty-text run skipped', () => {
    const lines: ColoredLine[] = [
      { runs: [{ text: 'Hello', color: '#111111', bold: true }] },
      { runs: [{ text: '', color: '#000000' }] },
      { runs: [{ text: 'World', color: '#222222' }] },
    ]
    const blocks = renderTextPou(lines, 'normal', 200, 500)
    expect(blocks).toHaveLength(1)
    const texts = blocks[0].ops.filter((op) => op.kind === 'text').map((op) => (op.kind === 'text' ? op.text : ''))
    expect(texts).toContain('Hello')
    expect(texts).toContain('World')
    const helloOp = blocks[0].ops.find((op) => op.kind === 'text' && op.text === 'Hello')
    expect(helloOp).toMatchObject({ font: 'monoBold' })
    const worldOp = blocks[0].ops.find((op) => op.kind === 'text' && op.text === 'World')
    expect(worldOp).toMatchObject({ font: 'mono' })
  })

  it('normal mode: forces pagination across multiple blocks when content overflows the page', () => {
    const lines: ColoredLine[] = Array.from({ length: 10 }, (_, i) => ({
      runs: [{ text: `Line${i}`, color: '#000000' }],
    }))
    const blocks = renderTextPou(lines, 'normal', 200, 30)
    expect(blocks.length).toBeGreaterThan(1)
    const firstTexts = blocks[0].ops.filter((op) => op.kind === 'text').map((op) => (op.kind === 'text' ? op.text : ''))
    expect(firstTexts).toContain('Line0')
    const lastTexts = blocks[blocks.length - 1].ops
      .filter((op) => op.kind === 'text')
      .map((op) => (op.kind === 'text' ? op.text : ''))
    expect(lastTexts).toContain('Line9')
  })

  it('scale-to-fit mode: a short line fits one page at the found font size (singleBlock)', () => {
    const lines: ColoredLine[] = [{ runs: [{ text: 'Hi', color: '#000000' }] }]
    const blocks = renderTextPou(lines, 'scale-to-fit', 300, 300)
    expect(blocks).toHaveLength(1)
    const texts = blocks[0].ops.filter((op) => op.kind === 'text').map((op) => (op.kind === 'text' ? op.text : ''))
    expect(texts).toContain('Hi')
  })

  it('scale-to-fit mode: falls back to chunked pagination when even the minimum size overflows', () => {
    const lines: ColoredLine[] = Array.from({ length: 100 }, (_, i) => ({
      runs: [{ text: `L${i}`, color: '#000000' }],
    }))
    const blocks = renderTextPou(lines, 'scale-to-fit', 200, 5)
    expect(blocks.length).toBeGreaterThan(1)
  })
})
