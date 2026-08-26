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

  it('emits the c_blocks baseline (interface header + raw IEC typedefs) before per-POU code', () => {
    const variables: PLCVariable[] = [makeScalarVar('x', 'input', 'INT')]
    const code = 'void setup() { }\nvoid loop() { }'
    const result = generateCBlocksCode([{ name: 'B', code, variables }])

    // Baseline: the interface header, which defines the struct and carries the
    // strucpp wrappers and the project's own types transitively.
    expect(result).toContain('#include "c_blocks.h"')
    // Baseline: raw file-scope typedefs for user-local variables.
    expect(result).toContain('typedef int16_t   IEC_INT;')
    expect(result).toContain('typedef float    IEC_REAL;')
    // STRING no longer has a raw POD typedef.  The historical
    // `{ __strlen_t len; uint8_t body[]; }` struct is gone — STRING
    // pins and locals both use `strucpp::IEC_STRING` (= IECStringVar
    // <254>) from `iec_string.hpp`.  Pin the regression so a future
    // edit can't quietly re-introduce the raw shape.
    expect(result).not.toContain('__strlen_t')
    expect(result).not.toContain('STR_MAX_LEN')
    expect(result).not.toMatch(/typedef\s+struct\s+\{[\s\S]*?body\[[\s\S]*?\]\s*;[\s\S]*?\}\s+IEC_STRING;/)
  })

  it("undefines Arduino.h's min/max macros before pulling in strucpp/std headers", () => {
    // Regression guard: Arduino.h defines `min` / `max` as preprocessor
    // macros that wreck `<algorithm>` / `<limits>` (pulled in transitively by
    // the strucpp headers behind c_blocks.h). Order must be:
    //   include <Arduino.h>  ->  #undef min/max  ->  #include "c_blocks.h"
    const variables: PLCVariable[] = [makeScalarVar('x', 'input', 'INT')]
    const code = 'void setup() { }\nvoid loop() { }'
    const result = generateCBlocksCode([{ name: 'B', code, variables }])

    const arduinoIdx = result.indexOf('#include <Arduino.h>')
    const undefMinIdx = result.indexOf('#undef min')
    const undefMaxIdx = result.indexOf('#undef max')
    const strucppIdx = result.indexOf('#include "c_blocks.h"')

    expect(arduinoIdx).toBeGreaterThan(-1)
    expect(undefMinIdx).toBeGreaterThan(arduinoIdx)
    expect(undefMaxIdx).toBeGreaterThan(arduinoIdx)
    expect(strucppIdx).toBeGreaterThan(undefMinIdx)
    expect(strucppIdx).toBeGreaterThan(undefMaxIdx)
  })

  it('generates struct, extern declarations, defines, code, and undefs for a pou', () => {
    const variables: PLCVariable[] = [makeScalarVar('speed', 'input', 'INT'), makeScalarVar('result', 'output', 'REAL')]
    const code = 'void setup() { }\nvoid loop() { }'

    const result = generateCBlocksCode([{ name: 'MyBlock', code, variables }])

    // The struct and the two entry-point declarations belong to c_blocks.h and
    // must NOT be restated here. Two definitions of one typedef is what broke
    // enumeration pins: the header spelled the field `strucpp::IEC_MODE` and
    // this file spelled it `strucpp::MODE`, so the assignment in the POU glue
    // failed to compile. Pin the absence so the duplication cannot come back.
    expect(result).not.toContain('typedef struct {')
    expect(result).not.toContain('} MYBLOCK_VARS;')
    expect(result).not.toContain('strucpp::IEC_INT *SPEED;')
    expect(result).not.toContain('extern "C" void myblock_setup(MYBLOCK_VARS *vars);')

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

    // The struct lives in c_blocks.h — see the duplication regression above.
    expect(result).not.toContain('typedef struct {')
    expect(result).not.toContain('} EMPTY_VARS;')
    // No #define / #undef for variables (the only `#define`s in the
    // baseline now are the Arduino min/max macro guards).
    expect(result).not.toMatch(/^#define\s+\w+\s+\(/m)
    // Strip the baseline's `#undef min` / `#undef max` (Arduino.h macro
    // scrubbing — see baseline) before asserting no per-variable undefs.
    const withoutArduinoUndefs = result.replace(/^#undef\s+(min|max)\s*$/gm, '')
    expect(withoutArduinoUndefs).not.toMatch(/^#undef\s+\w+\s*$/m)
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

  describe('project type aliases', () => {
    const code = 'void setup() { }\nvoid loop() { }'
    const userVar = (name: string, typeName: string): PLCVariable => ({
      name,
      class: 'input',
      type: { definition: 'user-data-type', value: typeName },
      location: '',
      documentation: '',
      debug: false,
    })

    it('aliases every type the project declares, not only the ones a pin names', () => {
      // A type reachable only through a structure member still has to be in
      // scope: given `o : Outer` with a `State` member, the block writes
      // `o.STATE_ = STATE::BUSY`, and walking pin types alone left STATE
      // undeclared — which failed the build on hardware.
      const result = generateCBlocksCode(
        [{ name: 'B', code, variables: [userVar('o', 'Outer')] }],
        ['Outer', 'Inner', 'State'],
      )

      expect(result).toContain('using OUTER = strucpp::OUTER;')
      expect(result).toContain('using INNER = strucpp::INNER;')
      expect(result).toContain('using STATE = strucpp::STATE;')
    })

    it('aliases a type named by a pin even when the project does not declare it', () => {
      // A function block is a POU, not a data type, so it never appears among
      // the project's dataTypes — but a block holding an instance may want to
      // name the class.
      const result = generateCBlocksCode([{ name: 'B', code, variables: [userVar('h', 'Helper')] }], [])

      expect(result).toContain('using HELPER = strucpp::HELPER;')
    })

    it('emits each alias once when a type is both declared and named by a pin', () => {
      const result = generateCBlocksCode([{ name: 'B', code, variables: [userVar('m', 'Motor')] }], ['Motor'])

      expect(result.match(/using MOTOR = strucpp::MOTOR;/g)).toHaveLength(1)
    })

    it('aliases the element type of an array of a user type', () => {
      const bank: PLCVariable = {
        name: 'bank',
        class: 'input',
        type: {
          definition: 'array',
          value: 'ARRAY [0..3] OF Motor',
          data: { baseType: { definition: 'user-data-type', value: 'Motor' }, dimensions: [{ dimension: '0..3' }] },
        },
        location: '',
        documentation: '',
        debug: false,
      }
      const result = generateCBlocksCode([{ name: 'B', code, variables: [bank] }], [])

      expect(result).toContain('using MOTOR = strucpp::MOTOR;')
    })

    it('emits no alias block when the project has no user types at all', () => {
      const result = generateCBlocksCode([{ name: 'B', code, variables: [makeScalarVar('x', 'input', 'INT')] }], [])

      expect(result).not.toContain('using ')
    })
  })

  it('binds every class the user can declare, and nothing the toolchain injected', () => {
    const byClass = (name: string, cls: PLCVariable['class'], type: string): PLCVariable => ({
      name,
      class: cls,
      type: { definition: 'base-type', value: type },
      location: '',
      documentation: '',
      debug: false,
    })
    const variables: PLCVariable[] = [
      makeScalarVar('inVar', 'input', 'INT'),
      byClass('localVar', 'local', 'INT'),
      byClass('tempVar', 'temp', 'INT'),
      byClass('ioVar', 'inOut', 'INT'),
      byClass('hasBeenInitialized', 'local', 'BOOL'),
      makeScalarVar('outVar', 'output', 'INT'),
    ]
    const code = 'void setup() { }\nvoid loop() { }'

    const result = generateCBlocksCode([{ name: 'test', code, variables }])

    expect(result).toContain('#define inVar')
    expect(result).toContain('#define outVar')
    expect(result).toContain('#define localVar')
    expect(result).toContain('#define tempVar')
    expect(result).toContain('#define ioVar')
    // The setup() latch stays out of the user's reach — see the header tests.
    expect(result).not.toContain('#define hasBeenInitialized')
    expect(result).toContain('#undef inVar')
    expect(result).toContain('#undef outVar')
    expect(result).toContain('#undef localVar')
    expect(result).toContain('#undef tempVar')
    expect(result).toContain('#undef ioVar')
    expect(result).not.toContain('#undef hasBeenInitialized')
  })
})
