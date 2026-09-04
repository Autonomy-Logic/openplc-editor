import type { PLCPou } from '../../../middleware/shared/ports/types'
import { canExportPdf } from '../print-availability'

const stubPou: PLCPou = {
  name: 'main',
  pouType: 'program',
  body: { language: 'st', value: '' },
}

describe('canExportPdf', () => {
  it('returns false for an empty POU list', () => {
    expect(canExportPdf([])).toBe(false)
  })

  it('returns true when at least one POU exists', () => {
    expect(canExportPdf([stubPou])).toBe(true)
  })
})
