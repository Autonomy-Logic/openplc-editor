import type { PLCVariable } from '../../../../../middleware/shared/ports/types'
import { generateCBlocksCode } from '../generateCBlocksCode'

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

describe('generateCBlocksCode', () => {
  it('returns empty string for empty pous array', () => {
    const result = generateCBlocksCode([])
    expect(result).toBe('')
  })

  it('generates struct, extern declarations, defines, code, and undefs for a pou', () => {
    const variables: PLCVariable[] = [makeScalarVar('speed', 'input', 'INT'), makeScalarVar('result', 'output', 'REAL')]
    const code = 'void setup() { }\nvoid loop() { }'

    const result = generateCBlocksCode([{ name: 'MyBlock', code, variables }])

    // Struct definition
    expect(result).toContain('//definition of external blocks - MYBLOCK')
    expect(result).toContain('typedef struct {')
    expect(result).toContain('  IEC_INT *SPEED;')
    expect(result).toContain('  IEC_REAL *RESULT;')
    expect(result).toContain('} MYBLOCK_VARS;')

    // Extern declarations
    expect(result).toContain('extern "C" void myblock_setup(MYBLOCK_VARS *vars);')
    expect(result).toContain('extern "C" void myblock_loop(MYBLOCK_VARS *vars);')

    // Defines for input and output
    expect(result).toContain('#define speed (*(vars->SPEED))')
    expect(result).toContain('#define result (*(vars->RESULT))')

    // Function signature replacement
    expect(result).toContain('void myblock_setup(MYBLOCK_VARS *vars)')
    expect(result).toContain('void myblock_loop(MYBLOCK_VARS *vars)')
    expect(result).not.toContain('void setup()')
    expect(result).not.toContain('void loop()')

    // Undefs
    expect(result).toContain('#undef speed')
    expect(result).toContain('#undef result')
  })

  it('generates array defines with direct struct dereference (no pointer deref)', () => {
    const variables: PLCVariable[] = [makeArrayVar('data', 'input', 'INT', '0..9')]
    const code = 'void setup() { }\nvoid loop() { }'

    const result = generateCBlocksCode([{ name: 'test', code, variables }])

    // Array variables use (vars->NAME) not (*(vars->NAME))
    expect(result).toContain('#define data (vars->DATA)')
    expect(result).not.toContain('#define data (*(vars->DATA))')
  })

  it('handles pou with no variables', () => {
    const code = 'void setup() { }\nvoid loop() { }'

    const result = generateCBlocksCode([{ name: 'empty', code, variables: [] }])

    expect(result).toContain('typedef struct {')
    expect(result).toContain('} EMPTY_VARS;')
    // No defines or undefs for variables
    expect(result).not.toContain('#define')
    expect(result).not.toContain('#undef')
  })

  it('processes multiple pous', () => {
    const pou1 = {
      name: 'Block1',
      code: 'void setup() { }\nvoid loop() { }',
      variables: [makeScalarVar('x', 'input', 'INT')],
    }
    const pou2 = {
      name: 'Block2',
      code: 'void setup() { }\nvoid loop() { }',
      variables: [makeScalarVar('y', 'output', 'REAL')],
    }

    const result = generateCBlocksCode([pou1, pou2])

    expect(result).toContain('BLOCK1_VARS')
    expect(result).toContain('BLOCK2_VARS')
    expect(result).toContain('#define x (*(vars->X))')
    expect(result).toContain('#define y (*(vars->Y))')
    expect(result).toContain('#undef x')
    expect(result).toContain('#undef y')
  })

  it('only replaces setup and loop function signatures in user code', () => {
    const code = '// comment about setup\nvoid setup() { doSomething(); }\nvoid loop() { run(); }'
    const variables: PLCVariable[] = [makeScalarVar('val', 'input', 'BOOL')]

    const result = generateCBlocksCode([{ name: 'FB', code, variables }])

    expect(result).toContain('void fb_setup(FB_VARS *vars) { doSomething(); }')
    expect(result).toContain('void fb_loop(FB_VARS *vars) { run(); }')
    expect(result).toContain('// comment about setup')
  })

  it('filters variables by class (only input and output)', () => {
    const variables: PLCVariable[] = [
      makeScalarVar('inVar', 'input', 'INT'),
      {
        name: 'localVar',
        class: 'local',
        type: { definition: 'base-type', value: 'INT' },
        location: '',
        documentation: '',
        debug: false,
      },
      makeScalarVar('outVar', 'output', 'INT'),
    ]
    const code = 'void setup() { }\nvoid loop() { }'

    const result = generateCBlocksCode([{ name: 'test', code, variables }])

    expect(result).toContain('#define inVar')
    expect(result).toContain('#define outVar')
    expect(result).not.toContain('#define localVar')
    expect(result).toContain('#undef inVar')
    expect(result).toContain('#undef outVar')
    expect(result).not.toContain('#undef localVar')
  })
})
