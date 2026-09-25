/**
 * Arrays, which the spec could not express at all until now.
 *
 * The store keeps an array twice over: `value` as rendered IEC text
 * ("ARRAY [0..3] OF INT") and `data` as structured bounds. A caller writes
 * neither — it gives the ELEMENT type and the dimensions, and `apply` derives
 * both, so the two cannot disagree. `describe` has to hand back that same
 * shape: reporting the rendered text would produce a document that, applied
 * again, nests the array inside itself.
 */

import { parseApplySpec } from '../apply/schema'

const spec = (type: unknown) => ({
  specVersion: 1,
  pous: [{ name: 'P', kind: 'program', language: 'st', variables: [{ name: 'Buf', type }] }],
})

describe('the array type in a spec', () => {
  it('accepts an element type with dimensions', () => {
    const parsed = parseApplySpec(spec({ definition: 'array', value: 'INT', dimensions: ['0..3'] }))
    expect(parsed.ok).toBe(true)
  })

  it('accepts more than one dimension', () => {
    const parsed = parseApplySpec(spec({ definition: 'array', value: 'REAL', dimensions: ['0..3', '0..2'] }))
    expect(parsed.ok).toBe(true)
  })

  it('refuses an array with no dimensions — bounds are not optional', () => {
    const parsed = parseApplySpec(spec({ definition: 'array', value: 'INT' }))
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('expected a refusal')
    expect(parsed.issues.join(' ')).toContain('dimensions')
  })

  it('refuses dimensions on a type that is not an array', () => {
    const parsed = parseApplySpec(spec({ definition: 'base-type', value: 'INT', dimensions: ['0..3'] }))
    expect(parsed.ok).toBe(false)
  })

  it('still refuses the store’s internal shape, so the two cannot drift', () => {
    // `data` is derived, never supplied: accepting it would let a caller give
    // bounds that disagree with the rendered text.
    const parsed = parseApplySpec(
      spec({
        definition: 'array',
        value: 'INT',
        dimensions: ['0..3'],
        data: { baseType: { definition: 'base-type', value: 'INT' }, dimensions: [{ dimension: '0..3' }] },
      }),
    )
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('expected a refusal')
    expect(parsed.issues.join(' ')).toContain('data')
  })
})
