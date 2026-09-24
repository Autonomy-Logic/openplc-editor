import { clampImportedVariableWidth, VARIABLE_ELEMENT_MIN_WIDTH } from '../fbd-variable-width'

describe('clampImportedVariableWidth', () => {
  it('raises a width below the minimum to the minimum', () => {
    expect(clampImportedVariableWidth(40)).toBe(VARIABLE_ELEMENT_MIN_WIDTH)
  })

  it('keeps a width at or above the minimum', () => {
    expect(clampImportedVariableWidth(VARIABLE_ELEMENT_MIN_WIDTH)).toBe(VARIABLE_ELEMENT_MIN_WIDTH)
    expect(clampImportedVariableWidth(90)).toBe(90)
  })

  it('leaves a missing width alone so the default applies', () => {
    expect(clampImportedVariableWidth(0)).toBe(0)
  })
})
