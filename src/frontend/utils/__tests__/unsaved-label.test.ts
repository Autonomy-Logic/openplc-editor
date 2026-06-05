import { isUnsaved, unsavedLabel } from '../unsaved-label'

describe('unsavedLabel', () => {
  it('returns undefined when label is undefined', () => {
    expect(unsavedLabel(undefined, { saved: true })).toBeUndefined()
  })

  it('returns label as-is when no associated file', () => {
    expect(unsavedLabel('test', undefined)).toBe('test')
  })

  it('returns label as-is when file is saved', () => {
    expect(unsavedLabel('test', { saved: true })).toBe('test')
  })

  it('prepends asterisk when file is unsaved', () => {
    expect(unsavedLabel('test', { saved: false })).toBe('* test')
  })

  it('returns undefined for undefined label even when file is unsaved', () => {
    expect(unsavedLabel(undefined, { saved: false })).toBeUndefined()
  })
})

describe('isUnsaved', () => {
  it('returns false when no associated file', () => {
    expect(isUnsaved(undefined)).toBe(false)
  })

  it('returns false when file is saved', () => {
    expect(isUnsaved({ saved: true })).toBe(false)
  })

  it('returns true when file is unsaved', () => {
    expect(isUnsaved({ saved: false })).toBe(true)
  })
})
