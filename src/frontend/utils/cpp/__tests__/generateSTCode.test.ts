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

  it('assigns a pointer for every class the struct carries', () => {
    // The assignments and the struct must select the same variables: a field
    // the assignments skip is a dangling pointer the user's first write
    // follows. Both read `cBlockInterfaceVariables`, and this pins the result.
    const byClass = (name: string, cls: PLCVariable['class']): PLCVariable => ({
      name,
      class: cls,
      type: { definition: 'base-type', value: 'INT' },
      location: '',
      documentation: '',
      debug: false,
    })

    const result = generateSTCode({
      pouName: 'test',
      allVariables: [
        makeScalarVar('x', 'input', 'INT'),
        byClass('localVal', 'local'),
        byClass('tempVal', 'temp'),
        byClass('ioVal', 'inOut'),
      ],
    })

    expect(result).toContain('vars.X = &X;')
    expect(result).toContain('vars.LOCALVAL = &LOCALVAL;')
    expect(result).toContain('vars.TEMPVAL = &TEMPVAL;')
    expect(result).toContain('vars.IOVAL = &IOVAL;')
  })

  describe('VAR_EXTERNAL', () => {
    const ext = (name: string): PLCVariable => ({
      name,
      class: 'external',
      type: { definition: 'base-type', value: 'DINT' },
      location: '',
      documentation: '',
      debug: false,
    })

    const extArray = (name: string, dimension: string): PLCVariable => ({
      name,
      class: 'external',
      type: {
        definition: 'array',
        value: `ARRAY [${dimension}] OF INT`,
        data: { baseType: { definition: 'base-type', value: 'INT' }, dimensions: [{ dimension }] },
      },
      location: '',
      documentation: '',
      debug: false,
    })

    it('takes each global’s pointer inside that global’s own lock', () => {
      // strucpp holds a global as a `GlobalVar<V>` — value plus mutex — and
      // hands out a `V*` only through `with_lock`. Filling the field anywhere
      // else would compile and silently drop the lock.
      const result = generateSTCode({ pouName: 'blk', allVariables: [ext('gCount')] })

      expect(result).toContain('GCOUNT->with_lock([&](auto* g0) {')
      expect(result).toContain('vars.GCOUNT = g0;')
    })

    it('deduces the pointer type instead of naming it', () => {
      // `V` is IEC_DINT for a scalar, MOTOR for a structure, IEC_MODE for an
      // enumeration and Array1D<IEC_INT, 0, 3> for an array. Writing any of
      // those here would restate the compiler's layout, which has to stay
      // stated in one place.
      const result = generateSTCode({ pouName: 'blk', allVariables: [ext('gCount')] })

      expect(result).toContain('auto* g0')
      expect(result).not.toContain('GlobalVar<')
    })

    it('holds the lock across the call, not merely around the assignment', () => {
      const result = generateSTCode({ pouName: 'blk', allVariables: [ext('gCount')] })
      const openIdx = result.indexOf('GCOUNT->with_lock')
      const callIdx = result.indexOf('blk_loop(&vars);')
      const closeIdx = result.indexOf('});', callIdx)

      expect(openIdx).toBeGreaterThan(-1)
      expect(callIdx).toBeGreaterThan(openIdx)
      expect(closeIdx).toBeGreaterThan(callIdx)
    })

    it('wraps setup as well as loop, since setup may touch a global too', () => {
      const result = generateSTCode({ pouName: 'blk', allVariables: [ext('gCount')] })

      expect(result.match(/GCOUNT->with_lock/g)).toHaveLength(2)
    })

    it('nests several globals in name order, identically in every block', () => {
      // A fixed order is what stops two blocks taking the same pair of globals
      // in opposite orders and deadlocking.
      const result = generateSTCode({
        pouName: 'blk',
        allVariables: [ext('gZulu'), ext('gAlpha'), ext('gMike')],
      })

      const order = ['GALPHA', 'GMIKE', 'GZULU'].map((n) => result.indexOf(`${n}->with_lock`))
      expect(order).toEqual([...order].sort((a, b) => a - b))
    })

    it('offsets an array global so it indexes by the declared IEC range', () => {
      const result = generateSTCode({ pouName: 'blk', allVariables: [extArray('gArr', '2..5')] })

      expect(result).toContain('vars.GARR = &g0_arr[2] - 2;')
    })

    it('binds the array dereference to a reference, never inline as `(*g)`', () => {
      // This C++ sits inside an `{external}` block that the ST front end still
      // scans, and `(*` opens a block comment there: inline would swallow the
      // rest of the POU and fail as `Unclosed block comment`.
      const result = generateSTCode({ pouName: 'blk', allVariables: [extArray('gArr', '0..3')] })

      expect(result).toContain('auto& g0_arr = *g0;')
      expect(result).not.toContain('(*g0)')
    })

    it('emits no wrapper at all when the block declares no externals', () => {
      const result = generateSTCode({ pouName: 'blk', allVariables: [makeScalarVar('x', 'input', 'INT')] })

      expect(result).not.toContain('with_lock')
      expect(result).toContain('blk_loop(&vars);')
    })
  })

  it('does not assign the latch the toolchain injects', () => {
    const result = generateSTCode({
      pouName: 'test',
      allVariables: [
        makeScalarVar('x', 'input', 'INT'),
        {
          name: 'hasBeenInitialized',
          class: 'local',
          type: { definition: 'base-type', value: 'BOOL' },
          location: '',
          documentation: '',
          debug: false,
        },
      ],
    })

    expect(result).not.toContain('vars.HASBEENINITIALIZED')
  })
})
