import { PDFDocument } from 'pdf-lib'

import { getTestFontSet } from './fixtures/test-font-set'
import type { PdfBackend } from '../pdf-writer'
import { createPdfLibBackend, drawPages } from '../pdf-writer'
import type { DrawOp, PdfPageContent } from '../types'

describe('createPdfLibBackend', () => {
  it('throws if a drawing op is received before any page was added', async () => {
    const backend = await createPdfLibBackend(getTestFontSet())
    expect(() => backend.drawLine(0, 0, 10, 10, { r: 0, g: 0, b: 0 }, 1)).toThrow(
      'pdf-writer: drawing op received before any page was added',
    )
  })

  it('draws every op kind and produces a valid, re-parseable single-page PDF', async () => {
    const backend = await createPdfLibBackend(getTestFontSet())
    backend.addPage(400, 600)

    backend.drawLine(0, 0, 10, 10, { r: 0, g: 0, b: 0 }, 1)
    backend.drawRect(0, 0, 50, 50, { fill: { r: 1, g: 0, b: 0 } })
    backend.drawRect(0, 0, 50, 50, { stroke: { r: 0, g: 1, b: 0 }, strokeWidthPt: 2 })
    backend.drawRect(0, 0, 50, 50, { stroke: { r: 0, g: 0, b: 1 }, fill: { r: 1, g: 1, b: 0 } })
    backend.drawSvgPath('M0 0 L10 10', 0, 0, 1, { fill: { r: 0, g: 0, b: 0 }, stroke: { r: 1, g: 1, b: 1 } })
    backend.drawText('Hello', 10, 10, 12, { r: 0, g: 0, b: 0 }, 'sans', 'left')
    backend.drawText('Hello', 10, 10, 12, { r: 0, g: 0, b: 0 }, 'sansBold', 'center')
    backend.drawText('Hello', 10, 10, 12, { r: 0, g: 0, b: 0 }, 'mono', 'right')
    backend.drawText('Hello', 10, 10, 12, { r: 0, g: 0, b: 0 }, 'monoBold', 'left')
    backend.clipPush(0, 0, 50, 50)
    backend.clipPop()

    const bytes = await backend.finish()
    expect(bytes.length).toBeGreaterThan(0)

    const reparsed = await PDFDocument.load(bytes)
    expect(reparsed.getPageCount()).toBe(1)
  })
})

describe('drawPages', () => {
  function makeFakeBackend(): PdfBackend {
    return {
      addPage: vi.fn(),
      drawLine: vi.fn(),
      drawRect: vi.fn(),
      drawSvgPath: vi.fn(),
      drawText: vi.fn(),
      clipPush: vi.fn(),
      clipPop: vi.fn(),
      finish: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    }
  }

  it('replays every DrawOp kind onto the backend, one addPage per page', () => {
    const backend = makeFakeBackend()
    const page1Ops: DrawOp[] = [
      { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 10, color: '#010203', widthPt: 1 },
      { kind: 'rect', x: 0, y: 0, width: 5, height: 5, stroke: '#040506', strokeWidthPt: 1, fill: '#070809' },
      { kind: 'path', d: 'M0 0', x: 0, y: 0, scale: 2, stroke: '#0a0b0c', strokeWidthPt: 1, fill: '#0d0e0f' },
      { kind: 'text', text: 'hi', x: 1, y: 1, sizePt: 9, color: '#101112', font: 'sans', align: 'center' },
      { kind: 'clipPush', x: 0, y: 0, width: 5, height: 5 },
      { kind: 'clipPop' },
    ]
    const page2Ops: DrawOp[] = [{ kind: 'clipPop' }]
    const pages: PdfPageContent[] = [
      { widthPt: 100, heightPt: 200, ops: page1Ops },
      { widthPt: 150, heightPt: 250, ops: page2Ops },
    ]

    drawPages(backend, pages)

    expect(backend.addPage).toHaveBeenCalledTimes(2)
    expect(backend.addPage).toHaveBeenNthCalledWith(1, 100, 200)
    expect(backend.addPage).toHaveBeenNthCalledWith(2, 150, 250)

    expect(backend.drawLine).toHaveBeenCalledWith(0, 0, 10, 10, { r: 1 / 255, g: 2 / 255, b: 3 / 255 }, 1)
    expect(backend.drawRect).toHaveBeenCalledWith(0, 0, 5, 5, {
      stroke: { r: 4 / 255, g: 5 / 255, b: 6 / 255 },
      strokeWidthPt: 1,
      fill: { r: 7 / 255, g: 8 / 255, b: 9 / 255 },
    })
    expect(backend.drawSvgPath).toHaveBeenCalledWith('M0 0', 0, 0, 2, {
      stroke: { r: 10 / 255, g: 11 / 255, b: 12 / 255 },
      strokeWidthPt: 1,
      fill: { r: 13 / 255, g: 14 / 255, b: 15 / 255 },
    })
    expect(backend.drawText).toHaveBeenCalledWith(
      'hi',
      1,
      1,
      9,
      { r: 16 / 255, g: 17 / 255, b: 18 / 255 },
      'sans',
      'center',
    )
    expect(backend.clipPush).toHaveBeenCalledWith(0, 0, 5, 5)
    expect(backend.clipPop).toHaveBeenCalledTimes(2)
  })

  it('defaults align to left and scale to 1 when not provided on the op', () => {
    const backend = makeFakeBackend()
    const ops: DrawOp[] = [
      { kind: 'path', d: 'M0 0', x: 0, y: 0, fill: '#000000' },
      { kind: 'text', text: 'x', x: 0, y: 0, sizePt: 1, color: '#000000', font: 'sans' },
    ]
    drawPages(backend, [{ widthPt: 10, heightPt: 10, ops }])

    expect(backend.drawSvgPath).toHaveBeenCalledWith('M0 0', 0, 0, 1, {
      stroke: undefined,
      strokeWidthPt: undefined,
      fill: { r: 0, g: 0, b: 0 },
    })
    expect(backend.drawText).toHaveBeenCalledWith('x', 0, 0, 1, { r: 0, g: 0, b: 0 }, 'sans', 'left')
  })

  it('the switch is exhaustive over every real DrawOp kind — an unknown kind hits the never-typed default', () => {
    const backend = makeFakeBackend()
    // Deliberately invalid input to exercise the defensive exhaustiveness check;
    // DrawOp itself has no such variant, so this cannot happen at runtime.
    // @ts-expect-error -- intentionally invalid `kind` to hit the exhaustive-switch default
    const bogus: DrawOp = { kind: 'bogus' }
    expect(() => drawPages(backend, [{ widthPt: 10, heightPt: 10, ops: [bogus] }])).not.toThrow()
  })
})
