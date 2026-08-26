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

  it('pulls in the generated declarations so every field type resolves', () => {
    // Struct fields name strucpp types across the whole range the Variables
    // Table can declare: `strucpp::IEC_*` wrappers for elementary pins, and the
    // project's own structures, enumerations and function block classes for the
    // rest. `generated.hpp` carries all of them (and the runtime wrappers
    // transitively), so a TU that includes c_blocks.h without any other setup
    // still compiles instead of failing with `'IEC_STRING' does not name a
    // type` or `'MOTOR' does not name a type`.
    const result = generateCBlocksHeader([])
    expect(result).toContain('#include "generated.hpp"')
  })

  describe('user-defined types', () => {
    // strucpp spells the two shapes differently, and the variable alone cannot
    // say which it is:
    //
    //   struct MOTOR { … };  using IEC_MOTOR = MOTOR;
    //   enum class MODE { … }; using IEC_MODE = IEC_ENUM<MODE>;
    //   class HELPER { … };                    // no alias at all
    //
    // A structure and an enumeration are both declared in the project's data
    // types, so both get the `IEC_` alias. A function block instance is not,
    // and taking `&instance` yields the bare class — spelling that field
    // `IEC_HELPER` would name a type that does not exist.
    const userVar = (name: string, cls: PLCVariable['class'], typeName: string): PLCVariable => ({
      name,
      class: cls,
      type: { definition: 'user-data-type', value: typeName },
      location: '',
      documentation: '',
      debug: false,
    })

    it('aliases a data type but leaves a function block instance bare', () => {
      const variables: PLCVariable[] = [
        userVar('m', 'input', 'Motor'),
        userVar('md', 'input', 'Mode'),
        userVar('h', 'input', 'Helper'),
      ]

      const result = generateCBlocksHeader([{ name: 'Blk', variables }], ['Motor', 'Mode'])

      expect(result).toContain('  strucpp::IEC_MOTOR *M;')
      expect(result).toContain('  strucpp::IEC_MODE *MD;')
      expect(result).toContain('  strucpp::HELPER *H;')
    })

    it('spells an array of a data type through the same rule', () => {
      const variables: PLCVariable[] = [
        {
          name: 'bank',
          class: 'input',
          type: {
            definition: 'array',
            value: 'ARRAY [0..3] OF Motor',
            data: {
              baseType: { definition: 'user-data-type', value: 'Motor' },
              dimensions: [{ dimension: '0..3' }],
            },
          },
          location: '',
          documentation: '',
          debug: false,
        },
      ]

      const result = generateCBlocksHeader([{ name: 'Blk', variables }], ['Motor'])

      expect(result).toContain('  strucpp::IEC_MOTOR *BANK;')
    })

    it('leaves every user type bare when the project declares no data types', () => {
      const variables: PLCVariable[] = [userVar('h', 'input', 'Helper')]

      expect(generateCBlocksHeader([{ name: 'Blk', variables }])).toContain('  strucpp::HELPER *H;')
    })
  })

  it('generates struct and function declarations for a pou with scalar variables', () => {
    const variables: PLCVariable[] = [makeScalarVar('speed', 'input', 'INT'), makeScalarVar('result', 'output', 'REAL')]

    const result = generateCBlocksHeader([{ name: 'MyBlock', variables }])

    expect(result).toContain('//definition of external blocks - MYBLOCK')
    expect(result).toContain('typedef struct {')
    expect(result).toContain('  strucpp::IEC_INT *SPEED;')
    expect(result).toContain('  strucpp::IEC_REAL *RESULT;')
    expect(result).toContain('} MYBLOCK_VARS;')
    expect(result).toContain('extern "C" void myblock_setup(MYBLOCK_VARS *vars);')
    expect(result).toContain('extern "C" void myblock_loop(MYBLOCK_VARS *vars);')
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
    expect(result).toContain('extern "C" void empty_setup(EMPTY_VARS *vars);')
    expect(result).toContain('extern "C" void empty_loop(EMPTY_VARS *vars);')
  })

  it('generates pointer members for array variables', () => {
    const variables: PLCVariable[] = [makeArrayVar('temps', 'input', 'REAL', '0..9')]

    const result = generateCBlocksHeader([{ name: 'ArrBlock', variables }])

    expect(result).toContain('strucpp::IEC_REAL *TEMPS;')
  })
})
