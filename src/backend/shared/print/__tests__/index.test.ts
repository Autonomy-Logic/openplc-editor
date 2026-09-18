import { PDFDocument } from 'pdf-lib'

import { getTestFontSet } from './fixtures/test-font-set'
import { renderProjectToPdf } from '../index'
import type { PrintRequest } from '../types'

describe('renderProjectToPdf (integration)', () => {
  it('renders a full request through the real pipeline into a valid, re-parseable PDF', async () => {
    const req: PrintRequest = {
      projectName: 'Test Project',
      mode: 'normal',
      pagePolicy: 'new-page-per-pou',
      page: {
        size: 'a4',
        orientation: 'portrait',
        marginsPt: { top: 36, right: 36, bottom: 36, left: 36 },
      },
      pous: [
        {
          name: 'Test',
          kind: 'il',
          lines: [{ runs: [{ text: 'LD X', color: '#111111' }] }, { runs: [{ text: 'ST Y', color: '#222222' }] }],
          variables: [
            {
              name: 'X',
              varClass: 'input',
              flag: '',
              type: 'BOOL',
              location: '',
              initialValue: '',
              documentation: '',
              debug: false,
            },
          ],
        },
      ],
    }

    const bytes = await renderProjectToPdf(req, getTestFontSet())
    expect(bytes.length).toBeGreaterThan(0)

    const doc = await PDFDocument.load(bytes)
    // Exactly one POU, `new-page-per-pou` — a page count off by one here would
    // mean pagination broke without any single unit test noticing (each of
    // those asserts on `ContentBlock[]`/`DrawOp[]`, never on the final PDF).
    expect(doc.getPageCount()).toBe(1)
    const { width, height } = doc.getPage(0).getSize()
    expect(width).toBeCloseTo(595.28)
    expect(height).toBeCloseTo(841.89)
  })

  it('does not throw for characters outside the embedded fonts’ coverage (known limitation: unsupported glyphs render blank, not a crash)', async () => {
    const req: PrintRequest = {
      projectName: 'Test Project',
      mode: 'normal',
      pagePolicy: 'new-page-per-pou',
      page: { size: 'a4', orientation: 'portrait', marginsPt: { top: 36, right: 36, bottom: 36, left: 36 } },
      pous: [
        {
          // CJK + emoji: outside Noto Sans's embedded Latin coverage.
          name: '測試_😀',
          kind: 'il',
          lines: [{ runs: [{ text: 'LD X', color: '#111111' }] }],
          variables: [],
        },
      ],
    }

    const bytes = await renderProjectToPdf(req, getTestFontSet())

    expect(bytes.length).toBeGreaterThan(0)
    await expect(PDFDocument.load(bytes)).resolves.toBeDefined()
  })
})
