import type { PLCVariable } from '../../../../middleware/shared/ports/types'
import { generateSTCode } from '../generateSTCode'

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

describe('generateSTCode (cpp)', () => {
  it('generates ST stub with strucpp-style direct pointer assignment for scalars', () => {
    const result = generateSTCode({
      pouName: 'MyBlock',
      allVariables: [makeScalarVar('speed', 'input', 'INT'), makeScalarVar('result', 'output', 'REAL')],
    })

    // Struct variable declaration
    expect(result).toContain('MYBLOCK_VARS vars;')

    // Scalars: take the IECVar member's address directly. The struct
    // field type is `strucpp::IEC_INT *` so user writes via the macro
    // `*name = 5` route through `IECVar::operator=` → set() and respect
    // forcing on the IEC side.
    expect(result).toContain('vars.SPEED = &SPEED;')
    expect(result).toContain('vars.RESULT = &RESULT;')

    // No legacy MatIEC `data__` plumbing left.
    expect(result).not.toContain('data__->')

    // Conditional setup
    expect(result).toContain('if hasBeenInitialized = False then')
    expect(result).toContain('myblock_setup(&vars);')
    expect(result).toContain('hasBeenInitialized := True;')

    // Loop call
    expect(result).toContain('myblock_loop(&vars);')
  })

  it('points struct field directly into the Array1D for base-type arrays', () => {
    const result = generateSTCode({
      pouName: 'ArrBlock',
      allVariables: [makeArrayVar('temps', 'input', 'REAL', '0..4')],
    })

    // Array1D<IEC_REAL,0,4> stores std::array<IECVar<REAL_t>,5>; element 0
    // sits at &TEMPS[0]. Subtracting the lower bound shifts the pointer
    // so vars->TEMPS[iec_idx] indexes correctly for any IEC range.
    expect(result).toContain('vars.TEMPS = &TEMPS[0] - 0;')

    // No flat staging copies for base-type arrays — per-element forcing
    // is preserved by pointing directly at the IECVar storage.
    expect(result).not.toContain('__flat_TEMPS')
    expect(result).not.toContain('data__->')
  })

  it('handles non-zero array start index correctly', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [makeArrayVar('arr', 'input', 'INT', '5..10')],
    })
    expect(result).toContain('vars.ARR = &ARR[5] - 5;')
  })

  it('skips output writeback for base-type array outputs (writes go through IECVar::operator=)', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [makeArrayVar('outArr', 'output', 'INT', '1..10')],
    })

    expect(result).toContain('vars.OUTARR = &OUTARR[1] - 1;')
    // No explicit writeback — user's `name[i] = 5` already calls
    // IECVar::operator= on the underlying element, force-respecting.
    expect(result).not.toContain('for (int __i')
  })

  it('stages STRING variables through a flat raw struct and writes back via IECStringVar', () => {
    const result = generateSTCode({
      pouName: 'StrBlock',
      allVariables: [makeScalarVar('inMsg', 'input', 'string'), makeScalarVar('outMsg', 'output', 'string')],
    })

    // Stage both strings — user keeps name.len / name.body[] syntax.
    expect(result).toContain('IEC_STRING __INMSG_stage;')
    expect(result).toContain('IEC_STRING __OUTMSG_stage;')

    // Input copy: read through .get() to honour forcing.
    expect(result).toContain('auto __s = INMSG.get();')
    expect(result).toContain('__INMSG_stage.len = (__strlen_t)__s.length();')
    expect(result).toContain('std::memcpy(__INMSG_stage.body, __s.c_str(), STR_MAX_LEN);')

    // Pointer in struct points at the staging copy, NOT the IECStringVar.
    expect(result).toContain('vars.INMSG = &__INMSG_stage;')
    expect(result).toContain('vars.OUTMSG = &__OUTMSG_stage;')

    // Writeback for outputs only — input strings are read-only from
    // the IEC side after copy-in.
    expect(result).toContain(
      'OUTMSG = strucpp::IECString<254>(reinterpret_cast<const char*>(__OUTMSG_stage.body), __OUTMSG_stage.len);',
    )
    expect(result).not.toContain('INMSG = strucpp::IECString<254>')
  })

  it('handles no variables', () => {
    const result = generateSTCode({
      pouName: 'empty',
      allVariables: [],
    })

    expect(result).toContain('EMPTY_VARS vars;')
    expect(result).toContain('empty_setup(&vars);')
    expect(result).toContain('empty_loop(&vars);')
  })

  it('handles mixed scalar, array, and string variables', () => {
    const result = generateSTCode({
      pouName: 'mixed',
      allVariables: [
        makeScalarVar('a', 'input', 'INT'),
        makeArrayVar('b', 'input', 'REAL', '0..2'),
        makeScalarVar('msg', 'input', 'string'),
        makeScalarVar('c', 'output', 'BOOL'),
        makeArrayVar('d', 'output', 'INT', '0..3'),
      ],
    })

    expect(result).toContain('vars.A = &A;')
    expect(result).toContain('vars.B = &B[0] - 0;')
    expect(result).toContain('vars.MSG = &__MSG_stage;')
    expect(result).toContain('vars.C = &C;')
    expect(result).toContain('vars.D = &D[0] - 0;')
  })

  it('filters out local variables', () => {
    const localVar: PLCVariable = {
      name: 'localVal',
      class: 'local',
      type: { definition: 'base-type', value: 'INT' },
      location: '',
      documentation: '',
      debug: false,
    }

    const result = generateSTCode({
      pouName: 'test',
      allVariables: [makeScalarVar('x', 'input', 'INT'), localVar],
    })

    expect(result).not.toContain('LOCALVAL')
  })
})
