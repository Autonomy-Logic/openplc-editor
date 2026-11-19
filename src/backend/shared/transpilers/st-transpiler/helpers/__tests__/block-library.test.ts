import { blockInfosFromVariant, resolveConversionFunctionName } from '../block-library'

describe('blockInfosFromVariant', () => {
  it('rejects malformed variants and variants without a string name', () => {
    expect(blockInfosFromVariant(null)).toBeNull()
    expect(blockInfosFromVariant([])).toBeNull()
    expect(blockInfosFromVariant({})).toBeNull()
    expect(blockInfosFromVariant({ name: 42 })).toBeNull()
  })

  it('defaults omitted fields on a valid function variant', () => {
    expect(blockInfosFromVariant({ name: 'CUSTOM_FUNCTION' })).toEqual({
      name: 'CUSTOM_FUNCTION',
      type: 'function',
      extensible: false,
      inputs: [],
      outputs: [],
      comment: '',
      usage: '',
    })
  })

  it('normalizes valid variable records and ignores malformed or control-pin entries', () => {
    expect(
      blockInfosFromVariant({
        name: 'CUSTOM_BLOCK',
        type: 'function-block-instance',
        extensible: true,
        variables: [
          null,
          { class: 'input' },
          { name: 'EN', class: 'input', type: { value: 'BOOL' } },
          { name: 'ENO', class: 'output', type: { value: 'BOOL' } },
          { name: 'IN', class: 'input', type: { value: 'REAL' } },
          { name: 'OUT', class: 'output', type: { value: 42 } },
          { name: 'BOTH', class: 'inOut', type: { value: 'INT' } },
          { name: 'LEGACY_BOTH', class: 'inout' },
          { name: 'IGNORED', class: 'local', type: { value: 'BOOL' } },
        ],
      }),
    ).toEqual({
      name: 'CUSTOM_BLOCK',
      type: 'functionBlock',
      extensible: true,
      inputs: [
        { name: 'IN', type: 'REAL', qualifier: 'none' },
        { name: 'BOTH', type: 'INT', qualifier: 'none' },
        { name: 'LEGACY_BOTH', type: 'ANY', qualifier: 'none' },
      ],
      outputs: [
        { name: 'OUT', type: 'ANY', qualifier: 'none' },
        { name: 'BOTH', type: 'INT', qualifier: 'none' },
        { name: 'LEGACY_BOTH', type: 'ANY', qualifier: 'none' },
      ],
      comment: '',
      usage: '',
    })
  })
})

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
    expect(resolveConversionFunctionName('TO_BCD', 'UDINT')).toBe('UDINT_TO_BCD')
    expect(resolveConversionFunctionName('TO_BCD', 'INT')).toBeNull()
  })

  it('covers identity, boolean, and temporal conversion exits', () => {
    expect(resolveConversionFunctionName('INT_TO_REAL', 'INT')).toBeNull()
    expect(resolveConversionFunctionName('TO_INT', 'INT')).toBeNull()
    expect(resolveConversionFunctionName('TO_BOOL', 'TIME')).toBeNull()
    expect(resolveConversionFunctionName('TO_BOOL', 'INT')).toBe('INT_TO_BOOL')
    expect(resolveConversionFunctionName('TO_TIME', 'INT')).toBe('INT_TO_TIME')
    expect(resolveConversionFunctionName('TO_DATE', 'DATE_AND_TIME')).toBe('DATE_AND_TIME_TO_DATE')
  })
})
