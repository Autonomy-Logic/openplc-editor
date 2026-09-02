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
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1)
    const { width, height } = doc.getPage(0).getSize()
    expect(width).toBeCloseTo(595.28)
    expect(height).toBeCloseTo(841.89)
  })
})
