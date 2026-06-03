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

  it('passes STRING variables by direct IECStringVar pointer — no staging, no boundary copy', () => {
    const result = generateSTCode({
      pouName: 'StrBlock',
      allVariables: [makeScalarVar('inMsg', 'input', 'string'), makeScalarVar('outMsg', 'output', 'string')],
    })

    // Strings are now `strucpp::IEC_STRING = IECStringVar<254>` on
    // both sides — c_blocks.h struct field is `strucpp::IEC_STRING *`
    // and the strucpp program member is `IECStringVar<254>`.  `&NAME`
    // matches the field type exactly, so we point directly and let
    // user writes (`name = "hi"`) route through `IECStringVar::
    // operator=` for force-respecting semantics — identical to how
    // numeric scalars are wired.
    expect(result).toContain('vars.INMSG = &INMSG;')
    expect(result).toContain('vars.OUTMSG = &OUTMSG;')

    // Regression guards: the historical flat-staging path is GONE.
    // Re-introducing it would re-break user POU compilation against
    // the strucpp wrapper (`.len` / `.body` / `__strlen_t` /
    // `STR_MAX_LEN` do not exist on `IECStringVar`).
    expect(result).not.toContain('__INMSG_stage')
    expect(result).not.toContain('__OUTMSG_stage')
    expect(result).not.toContain('__strlen_t')
    expect(result).not.toContain('STR_MAX_LEN')
    expect(result).not.toContain('std::memcpy')
    expect(result).not.toContain('IECString<254>(reinterpret_cast')
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
    // STRING uses the same direct-pointer path as every other scalar
    // (no `&__MSG_stage` boundary copy).
    expect(result).toContain('vars.MSG = &MSG;')
    expect(result).not.toContain('__MSG_stage')
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
