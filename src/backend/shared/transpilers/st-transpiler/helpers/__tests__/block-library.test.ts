import { resolveConversionFunctionName } from '../block-library'

describe('resolveConversionFunctionName', () => {
  it('rejects an unknown TO_<TYPE> shorthand even if it matches the name pattern', () => {
    expect(resolveConversionFunctionName('TO_FOO', 'REAL')).toBeNull()
  })
})
