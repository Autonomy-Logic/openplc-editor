import type { PLCVariable } from '../../../../middleware/shared/ports/types'
import type { ShmWalkContext } from '../shm-leaves'
import { encodeCharactersFromVariable } from '../encodeCharactersFromVariable'

/** These tests describe layout, not direction. */
const ctx: ShmWalkContext = { direction: 'in' }

const makeScalarVar = (name: string, baseType: string): PLCVariable => ({
  name,
  class: 'input',
  type: { definition: 'base-type', value: baseType },
  location: '',
  documentation: '',
  debug: false,
})

const makeArrayVar = (name: string, baseType: string, dimension: string): PLCVariable => ({
  name,
  class: 'input',
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

describe('encodeCharactersFromVariable', () => {
  it('returns = for empty array', () => {
    expect(encodeCharactersFromVariable([], ctx)).toBe('=')
  })

  it('returns = for undefined input', () => {
    expect(encodeCharactersFromVariable(undefined as unknown as PLCVariable[], ctx)).toBe('=')
  })

  it('returns = for null input', () => {
    expect(encodeCharactersFromVariable(null as unknown as PLCVariable[], ctx)).toBe('=')
  })

  it('encodes BOOL as B', () => {
    expect(encodeCharactersFromVariable([makeScalarVar('x', 'BOOL')], ctx)).toBe('=B')
  })

  it('encodes SINT as b', () => {
    expect(encodeCharactersFromVariable([makeScalarVar('x', 'SINT')], ctx)).toBe('=b')
  })

  it('encodes INT as h', () => {
    expect(encodeCharactersFromVariable([makeScalarVar('x', 'INT')], ctx)).toBe('=h')
  })

  it('encodes DINT as i', () => {
    expect(encodeCharactersFromVariable([makeScalarVar('x', 'DINT')], ctx)).toBe('=i')
  })

  it('encodes LINT as q', () => {
    expect(encodeCharactersFromVariable([makeScalarVar('x', 'LINT')], ctx)).toBe('=q')
  })

  it('encodes USINT as B', () => {
    expect(encodeCharactersFromVariable([makeScalarVar('x', 'USINT')], ctx)).toBe('=B')
  })

  it('encodes UINT as H', () => {
    expect(encodeCharactersFromVariable([makeScalarVar('x', 'UINT')], ctx)).toBe('=H')
  })

  it('encodes UDINT as I', () => {
    expect(encodeCharactersFromVariable([makeScalarVar('x', 'UDINT')], ctx)).toBe('=I')
  })

  it('encodes ULINT as Q', () => {
    expect(encodeCharactersFromVariable([makeScalarVar('x', 'ULINT')], ctx)).toBe('=Q')
  })

  it('encodes REAL as f', () => {
    expect(encodeCharactersFromVariable([makeScalarVar('x', 'REAL')], ctx)).toBe('=f')
  })

  it('encodes LREAL as d', () => {
    expect(encodeCharactersFromVariable([makeScalarVar('x', 'LREAL')], ctx)).toBe('=d')
  })

  it('encodes BYTE as B', () => {
    expect(encodeCharactersFromVariable([makeScalarVar('x', 'BYTE')], ctx)).toBe('=B')
  })

  it('encodes WORD as H', () => {
    expect(encodeCharactersFromVariable([makeScalarVar('x', 'WORD')], ctx)).toBe('=H')
  })

  it('encodes DWORD as I', () => {
    expect(encodeCharactersFromVariable([makeScalarVar('x', 'DWORD')], ctx)).toBe('=I')
  })

  it('encodes LWORD as Q', () => {
    expect(encodeCharactersFromVariable([makeScalarVar('x', 'LWORD')], ctx)).toBe('=Q')
  })

  it('encodes STRING as b126s', () => {
    expect(encodeCharactersFromVariable([makeScalarVar('x', 'STRING')], ctx)).toBe('=b126s')
  })

  it('encodes multiple variables in order', () => {
    const vars = [makeScalarVar('a', 'INT'), makeScalarVar('b', 'REAL'), makeScalarVar('c', 'BOOL')]
    expect(encodeCharactersFromVariable(vars, ctx)).toBe('=hfB')
  })

  it('describes nothing at all when one type cannot cross', () => {
    // Emitting a format for the fields it *can* describe is the corruption this
    // whole design exists to prevent: a dropped field does not go missing, it
    // shifts every later field's offset. The compile path refuses such a POU
    // before reaching here; a direct caller gets an empty layout rather than a
    // half-formed one.
    const vars = [makeScalarVar('x', 'UNKNOWN_TYPE'), makeScalarVar('y', 'INT')]

    expect(encodeCharactersFromVariable(vars, ctx)).toBe('=')
  })

  it('encodes array variables with repeated format chars', () => {
    const vars = [makeArrayVar('arr', 'INT', '0..4')]
    expect(encodeCharactersFromVariable(vars, ctx)).toBe('=5h')
  })

  it('emits nothing for an array of STRING, which the walk refuses', () => {
    // This used to assert `'=b126sb126sb126s'` — the whole multi-item format
    // repeated per element, which is 6 slots where the decoder consumed 3, so
    // every variable declared after it read from the wrong offset. A repeat
    // count applies only to the first item of a struct format, so an array of
    // strings cannot be expressed as one leaf at all; the walk now refuses it
    // and the caller reports that instead of emitting a misaligned format.
    const vars = [makeArrayVar('arr', 'STRING', '0..2')]
    expect(encodeCharactersFromVariable(vars, ctx)).toBe('=')
  })

  it('skips array with unknown base type and warns', () => {
    const vars = [makeArrayVar('arr', 'UNKNOWN', '0..2')]
    const result = encodeCharactersFromVariable(vars, ctx)
    expect(result).toBe('=')
  })

  it('encodes mixed scalar and array variables', () => {
    const vars = [makeScalarVar('a', 'INT'), makeArrayVar('b', 'REAL', '0..2'), makeScalarVar('c', 'BOOL')]
    expect(encodeCharactersFromVariable(vars, ctx)).toBe('=h3fB')
  })
})
