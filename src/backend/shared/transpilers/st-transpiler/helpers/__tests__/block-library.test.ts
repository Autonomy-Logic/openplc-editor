import { resolveConversionFunctionName } from '../block-library'

describe('resolveConversionFunctionName', () => {
  it('resolves a supported concrete conversion', () => {
    expect(resolveConversionFunctionName('TO_INT', 'REAL')).toBe('REAL_TO_INT')
  })

  it('rejects an unknown TO_<TYPE> shorthand even if it matches the name pattern', () => {
    expect(resolveConversionFunctionName('TO_FOO', 'REAL')).toBeNull()
  })

  it('rejects unsupported temporal conversions', () => {
    expect(resolveConversionFunctionName('TO_TIME', 'DATE')).toBeNull()
  })

  it('supports BCD conversions only for unsigned integer types', () => {
    expect(resolveConversionFunctionName('TO_UINT', 'BCD')).toBe('BCD_TO_UINT')
    expect(resolveConversionFunctionName('TO_BCD', 'INT')).toBeNull()
  })
})
