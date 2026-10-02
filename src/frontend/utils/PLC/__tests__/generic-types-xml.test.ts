import type { PLCVariable } from '../../../../middleware/shared/ports/types'
import { baseTypeSchema } from '../../../../middleware/shared/ports/plc-schemas'
import { canonicalGenericType, isGenericType, PLCOPEN_GENERIC_TYPES } from '../generic-types'
import { generateStructMember } from '../array-codegen-helpers'
import { convertTypeToXml } from '../xml-generator/old-editor/type-xml'
import { parseTypeXml } from '../xml-parser/type-xml'

/**
 * Generic types across the PLCopen XML boundary.
 *
 * PLCopen TC6 v2.01 lists all ten in the `elementaryTypes` group, so each has
 * an element of its own — `<ANY/>`, not `<derived name="ANY"/>`, which would
 * name a user-defined type that happens to be called ANY.
 *
 * Internally they are `user-data-type`: `base-type` values are validated
 * against the elementary registry, and a generic is deliberately not in it.
 */
describe('generic types over PLCopen XML', () => {
  it('recognises exactly the ten PLCopen names', () => {
    expect([...PLCOPEN_GENERIC_TYPES]).toEqual([
      'ANY',
      'ANY_DERIVED',
      'ANY_ELEMENTARY',
      'ANY_MAGNITUDE',
      'ANY_NUM',
      'ANY_REAL',
      'ANY_INT',
      'ANY_BIT',
      'ANY_STRING',
      'ANY_DATE',
    ])
  })

  it('does not mistake a user type whose name merely starts with ANY', () => {
    expect(isGenericType('ANYTHING')).toBe(false)
    expect(canonicalGenericType('ANYTHING')).toBeNull()
  })

  it('compares case-insensitively, as IEC identifiers do', () => {
    expect(canonicalGenericType('any_int')).toBe('ANY_INT')
    expect(canonicalGenericType('  Any  ')).toBe('ANY')
  })

  it.each([...PLCOPEN_GENERIC_TYPES])('reads <%s/> as a named type, not a base type', (generic) => {
    // `base-type` would be a lie the project schema then rejects — see below.
    expect(parseTypeXml({ [generic]: '' })).toEqual({
      definition: 'user-data-type',
      value: generic,
    })
  })

  it.each([...PLCOPEN_GENERIC_TYPES])('writes %s back as its own element', (generic) => {
    expect(convertTypeToXml({ definition: 'user-data-type', value: generic })).toEqual({
      [generic]: '',
    })
  })

  it.each([...PLCOPEN_GENERIC_TYPES])('round-trips %s unchanged', (generic) => {
    const parsed = parseTypeXml({ [generic]: '' })
    expect(convertTypeToXml(parsed)).toEqual({ [generic]: '' })
  })

  it('is why a generic is not modelled as a base type', () => {
    // The project's own schema validates `base-type` values against the
    // elementary registry. Had the parser called a generic a base type, a
    // project that merely mentions ANY would fail to save.
    expect(baseTypeSchema.safeParse('ANY').success).toBe(false)
    expect(baseTypeSchema.safeParse('INT').success).toBe(true)
  })

  it('still writes a real user-defined type as a derived reference', () => {
    expect(convertTypeToXml({ definition: 'user-data-type', value: 'MOTOR' })).toEqual({
      derived: { '@name': 'MOTOR' },
    })
  })

  it('still reads a derived reference as a user type', () => {
    expect(parseTypeXml({ derived: { '@name': 'MOTOR' } })).toEqual({
      definition: 'derived',
      value: 'MOTOR',
    })
  })

  it('leaves ordinary base types alone in both directions', () => {
    expect(parseTypeXml({ INT: '' })).toEqual({ definition: 'base-type', value: 'INT' })
    expect(convertTypeToXml({ definition: 'base-type', value: 'INT' })).toEqual({ INT: '' })
  })

  it('reaches the native bridge as the IEC_ANY descriptor', () => {
    // The whole point of preserving the name: a native block declaring
    // `P : ANY` must still get a descriptor pin after a save/load cycle.
    const imported = parseTypeXml({ ANY: '' })
    const variable: PLCVariable = {
      name: 'p',
      class: 'input',
      type: imported,
      location: '',
      documentation: '',
      debug: false,
    }

    expect(generateStructMember(variable)).toBe('  strucpp::IEC_ANY *P;\n')
  })
})
