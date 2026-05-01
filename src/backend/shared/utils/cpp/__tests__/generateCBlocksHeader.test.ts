import type { PLCVariable } from '../../../../../middleware/shared/ports/types'
import { generateCBlocksHeader } from '../generateCBlocksHeader'

const makeScalarVar = (name: string, cls: 'input' | 'output', baseType: string): PLCVariable => ({
  name,
  class: cls,
  type: { definition: 'base-type', value: baseType },
  location: '',
  documentation: '',
  debug: false,
})

const makeArrayVar = (name: string, cls: 'input' | 'output', baseType: string, dimension: string): PLCVariable => ({
  name,
  class: cls,
  type: {
    definition: 'array',
    value: `ARRAY [${dimension}] OF ${baseType}`,
    data: {
      baseType: { definition: 'base-type', value: baseType },
      dimensions: [{ dimension }],
    },
  },
  location: '',
  documentation: '',
  debug: false,
})

describe('generateCBlocksHeader', () => {
  it('generates header with guard macros for empty pous array', () => {
    const result = generateCBlocksHeader([])
    expect(result).toContain('#ifndef C_BLOCKS_H')
    expect(result).toContain('#define C_BLOCKS_H')
    expect(result).toContain('#endif // C_BLOCKS_H')
  })

  it('generates struct and function declarations for a pou with scalar variables', () => {
    const variables: PLCVariable[] = [makeScalarVar('speed', 'input', 'INT'), makeScalarVar('result', 'output', 'REAL')]

    const result = generateCBlocksHeader([{ name: 'MyBlock', variables }])

    expect(result).toContain('//definition of external blocks - MYBLOCK')
    expect(result).toContain('typedef struct {')
    expect(result).toContain('  strucpp::IEC_INT *SPEED;')
    expect(result).toContain('  strucpp::IEC_REAL *RESULT;')
    expect(result).toContain('} MYBLOCK_VARS;')
    expect(result).toContain('void myblock_setup(MYBLOCK_VARS *vars);')
    expect(result).toContain('void myblock_loop(MYBLOCK_VARS *vars);')
  })

  it('includes only input and output variables in the struct', () => {
    const variables: PLCVariable[] = [
      makeScalarVar('inVar', 'input', 'INT'),
      {
        name: 'localVar',
        class: 'local',
        type: { definition: 'base-type', value: 'BOOL' },
        location: '',
        documentation: '',
        debug: false,
      },
      makeScalarVar('outVar', 'output', 'BOOL'),
    ]

    const result = generateCBlocksHeader([{ name: 'test', variables }])

    expect(result).toContain('strucpp::IEC_INT *INVAR;')
    expect(result).toContain('strucpp::IEC_BOOL *OUTVAR;')
    expect(result).not.toContain('LOCALVAR')
  })

  it('generates declarations for multiple pous', () => {
    const result = generateCBlocksHeader([
      { name: 'Block1', variables: [makeScalarVar('a', 'input', 'INT')] },
      { name: 'Block2', variables: [makeScalarVar('b', 'output', 'REAL')] },
    ])

    expect(result).toContain('BLOCK1_VARS')
    expect(result).toContain('block1_setup')
    expect(result).toContain('block1_loop')
    expect(result).toContain('BLOCK2_VARS')
    expect(result).toContain('block2_setup')
    expect(result).toContain('block2_loop')
  })

  it('handles pou with no variables', () => {
    const result = generateCBlocksHeader([{ name: 'Empty', variables: [] }])

    expect(result).toContain('typedef struct {')
    expect(result).toContain('} EMPTY_VARS;')
    expect(result).toContain('void empty_setup(EMPTY_VARS *vars);')
    expect(result).toContain('void empty_loop(EMPTY_VARS *vars);')
  })

  it('generates pointer members for array variables', () => {
    const variables: PLCVariable[] = [makeArrayVar('temps', 'input', 'REAL', '0..9')]

    const result = generateCBlocksHeader([{ name: 'ArrBlock', variables }])

    expect(result).toContain('strucpp::IEC_REAL *TEMPS;')
  })
})
