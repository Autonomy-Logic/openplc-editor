// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Tests for the `.dt` text parser — the inverse of
 * `serializeDataTypeToText`.  The core invariant is the round-trip:
 * `parse(serialize(x))` must deep-equal `x` for every shape the
 * visual editor can build.  Everything else is error reporting.
 */
import type { PLCDataType } from '../../../../middleware/shared/ports/types'
import { serializeDataTypeToText } from '../data-type-serializer'
import { parseDataTypeFromText } from '../data-type-text-parser'

const roundTrip = (dt: PLCDataType) => parseDataTypeFromText(serializeDataTypeToText(dt), dt.name)

describe('parseDataTypeFromText round-trips', () => {
  it('round-trips an enumerated type without an initial value', () => {
    const dt: PLCDataType = {
      name: 'Color',
      derivation: 'enumerated',
      values: [{ description: 'Red' }, { description: 'Green' }, { description: 'Blue' }],
      initialValue: '',
    }
    expect(roundTrip(dt)).toEqual({ dataType: dt })
  })

  it('round-trips an enumerated type with an initial value', () => {
    const dt: PLCDataType = {
      name: 'Mode',
      derivation: 'enumerated',
      values: [{ description: 'Auto' }, { description: 'Manual' }],
      initialValue: 'Auto',
    }
    expect(roundTrip(dt)).toEqual({ dataType: dt })
  })

  it('round-trips an empty enumeration (freshly created in the UI)', () => {
    const dt: PLCDataType = { name: 'Empty', derivation: 'enumerated', values: [], initialValue: '' }
    expect(roundTrip(dt)).toEqual({ dataType: dt })
  })

  it('round-trips a structure with base, user, and array fields', () => {
    const dt: PLCDataType = {
      name: 'Motor',
      derivation: 'structure',
      variable: [
        { name: 'speed', type: { definition: 'base-type', value: 'INT' } },
        { name: 'status', type: { definition: 'user-data-type', value: 'MotorState' } },
        {
          name: 'samples',
          type: {
            definition: 'array',
            value: 'ARRAY [1..5, 1..3] OF INT',
            data: {
              baseType: { definition: 'base-type', value: 'INT' },
              dimensions: [{ dimension: '1..5' }, { dimension: '1..3' }],
            },
          },
        },
      ],
    }
    expect(roundTrip(dt)).toEqual({ dataType: dt })
  })

  it('round-trips structure field initial values and documentation', () => {
    const dt: PLCDataType = {
      name: 'Config',
      derivation: 'structure',
      variable: [
        {
          name: 'rate',
          type: { definition: 'base-type', value: 'INT' },
          initialValue: { simpleValue: { value: '100' } },
          documentation: 'sampling rate in ms',
        },
        {
          name: 'enabled',
          type: { definition: 'base-type', value: 'BOOL' },
          initialValue: { simpleValue: { value: 'TRUE' } },
        },
      ],
    }
    expect(roundTrip(dt)).toEqual({ dataType: dt })
  })

  it('round-trips an empty structure (freshly created in the UI)', () => {
    const dt: PLCDataType = { name: 'Shell', derivation: 'structure', variable: [] }
    expect(roundTrip(dt)).toEqual({ dataType: dt })
  })

  it('round-trips a single-dimension array', () => {
    const dt: PLCDataType = {
      name: 'Buffer',
      derivation: 'array',
      baseType: { definition: 'base-type', value: 'INT' },
      initialValue: '',
      dimensions: [{ dimension: '0..9' }],
    }
    expect(roundTrip(dt)).toEqual({ dataType: dt })
  })

  it('round-trips a multi-dimension array of a user type with an initial value', () => {
    const dt: PLCDataType = {
      name: 'Grid',
      derivation: 'array',
      baseType: { definition: 'user-data-type', value: 'Cell' },
      initialValue: '[c1, c2]',
      dimensions: [{ dimension: '0..3' }, { dimension: '0..3' }],
    }
    expect(roundTrip(dt)).toEqual({ dataType: dt })
  })
})

describe('parseDataTypeFromText tolerance', () => {
  it('accepts keyword-case and whitespace variations', () => {
    const text = 'type\r\n\r\n  color : (Red, Green) ;\r\nend_type\r\n'
    const result = parseDataTypeFromText(text)
    expect(result.error).toBeUndefined()
    expect(result.dataType).toEqual({
      name: 'color',
      derivation: 'enumerated',
      values: [{ description: 'Red' }, { description: 'Green' }],
      initialValue: '',
    })
  })

  it('accepts a case-insensitive name match and normalises to the expected name', () => {
    const result = parseDataTypeFromText('TYPE\n  color : (Red);\nEND_TYPE\n', 'Color')
    expect(result.error).toBeUndefined()
    expect(result.dataType?.name).toBe('Color')
  })

  it('accepts END_STRUCT with spaced semicolon and lowercase struct keywords', () => {
    const text = 'TYPE\n  Point : struct\n    x : int;\n  end_struct ;\nEND_TYPE\n'
    const result = parseDataTypeFromText(text, 'Point')
    expect(result.error).toBeUndefined()
    expect(result.dataType).toEqual({
      name: 'Point',
      derivation: 'structure',
      variable: [{ name: 'x', type: { definition: 'base-type', value: 'INT' } }],
    })
  })
})

describe('parseDataTypeFromText errors', () => {
  it('rejects an empty file', () => {
    expect(parseDataTypeFromText('').error).toMatch(/empty file/)
    expect(parseDataTypeFromText('  \n \n').error).toMatch(/empty file/)
  })

  it('rejects a missing TYPE frame', () => {
    expect(parseDataTypeFromText('Color : (Red);\nEND_TYPE\n').error).toMatch(/must start with a TYPE/)
    expect(parseDataTypeFromText('TYPE\n  Color : (Red);\n').error).toMatch(/must end with END_TYPE/)
  })

  it('rejects a TYPE block with no declaration', () => {
    expect(parseDataTypeFromText('TYPE\nEND_TYPE\n').error).toMatch(/declares no data type/)
  })

  it('rejects more than one declaration per file', () => {
    const twoEnums = 'TYPE\n  A : (X);\n  B : (Y);\nEND_TYPE\n'
    expect(parseDataTypeFromText(twoEnums).error).toMatch(/exactly one data type/)
    const structPlusEnum = 'TYPE\n  P : STRUCT\n    x : INT;\n  END_STRUCT;\n  B : (Y);\nEND_TYPE\n'
    expect(parseDataTypeFromText(structPlusEnum).error).toMatch(/exactly one data type/)
  })

  it('rejects a structure without END_STRUCT', () => {
    expect(parseDataTypeFromText('TYPE\n  P : STRUCT\n    x : INT;\nEND_TYPE\n').error).toMatch(/missing END_STRUCT/)
  })

  it('rejects invalid structure fields with a hint', () => {
    const missingSemicolon = 'TYPE\n  P : STRUCT\n    x : INT\n  END_STRUCT;\nEND_TYPE\n'
    expect(parseDataTypeFromText(missingSemicolon).error).toMatch(/missing semicolon/)
    const missingColon = 'TYPE\n  P : STRUCT\n    x INT;\n  END_STRUCT;\nEND_TYPE\n'
    expect(parseDataTypeFromText(missingColon).error).toMatch(/missing colon/)
    const badFieldType = 'TYPE\n  P : STRUCT\n    x : MY TYPE;\n  END_STRUCT;\nEND_TYPE\n'
    expect(parseDataTypeFromText(badFieldType).error).toMatch(/invalid structure field/)
  })

  it('rejects invalid enumeration values', () => {
    expect(parseDataTypeFromText('TYPE\n  Color : (Red, 2bad);\nEND_TYPE\n').error).toMatch(/invalid enumeration value/)
  })

  it('rejects unrecognized declarations with a hint', () => {
    expect(parseDataTypeFromText('TYPE\n  Foo\nEND_TYPE\n').error).toMatch(/missing semicolon/)
    expect(parseDataTypeFromText('TYPE\n  Foo Bar;\nEND_TYPE\n').error).toMatch(/missing colon/)
    expect(parseDataTypeFromText('TYPE\n  Foo : ?!;\nEND_TYPE\n').error).toMatch(/unrecognized declaration format/)
  })

  it('rejects an invalid type name', () => {
    expect(parseDataTypeFromText('TYPE\n  2bad : (Red);\nEND_TYPE\n').error).toMatch(/invalid type name/)
  })

  it('rejects a declared name that does not match the expected name', () => {
    const result = parseDataTypeFromText('TYPE\n  Other : (Red);\nEND_TYPE\n', 'Color')
    expect(result.error).toMatch(/does not match the expected name "Color"/)
    expect(result.error).toMatch(/rename the data type via the project tree/)
  })
})
