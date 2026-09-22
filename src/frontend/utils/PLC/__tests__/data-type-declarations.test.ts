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
import { parseDataTypeFromText } from '../data-type-declarations'

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

describe('an enumeration with no members yet', () => {
  // `E : ();` is what the UI produces the moment a user adds an enumeration and
  // before they type a value into it. STruC++ refuses it — correctly, it cannot
  // compile — so the editor accepts it as work in progress.
  it('is accepted while it is being written', () => {
    const result = parseDataTypeFromText('TYPE State : (); END_TYPE', 'State')
    expect(result.error).toBeUndefined()
    expect(result.dataType).toEqual({ name: 'State', derivation: 'enumerated', values: [], initialValue: '' })
  })

  it('is still held to the name its file claims', () => {
    // This path used to return before the name check, so `datatypes/Foo.dt`
    // holding `TYPE Bar : (); END_TYPE` loaded as `Bar` — and the next save
    // wrote the type back under a name the tree never showed.
    const result = parseDataTypeFromText('TYPE Bar : (); END_TYPE', 'Foo')
    expect(result.dataType).toBeUndefined()
    expect(result.error).toContain('does not match the expected name')
  })

  it("takes the file's spelling when the two differ only in case", () => {
    expect(parseDataTypeFromText('TYPE state : (); END_TYPE', 'State').dataType?.name).toBe('State')
  })
})

describe('parseDataTypeFromText errors', () => {
  // These used to assert hand-written hints ("missing END_STRUCT", "invalid
  // enumeration value"). The parser is STruC++ now, so the wording is the
  // compiler's (DOPE-650) — which is the point: the editor reports what the
  // build would report, rather than a second opinion that could disagree with
  // it. What matters is that each input is still refused, and that the message
  // names the token the user has to look at.

  const errorFor = (source: string): string => {
    const result = parseDataTypeFromText(source)
    expect(result.dataType).toBeUndefined()
    expect(result.error).toBeDefined()
    return result.error ?? ''
  }

  it('rejects an empty file', () => {
    expect(errorFor('')).toMatch(/declares no data type/)
    expect(errorFor('  \n \n')).toMatch(/declares no data type/)
  })

  it('rejects a declaration outside a TYPE frame', () => {
    expect(errorFor('Color : (Red);\nEND_TYPE\n')).toBeTruthy()
    expect(errorFor('TYPE\n  Color : (Red);\n')).toMatch(/END_TYPE/)
  })

  it('rejects a TYPE block with no declaration', () => {
    expect(errorFor('TYPE\nEND_TYPE\n')).toMatch(/declares no data type/)
  })

  it('rejects more than one declaration per file', () => {
    expect(errorFor('TYPE\n  A : (X);\n  B : (Y);\nEND_TYPE\n')).toMatch(/exactly one data type/)
    expect(errorFor('TYPE\n  P : STRUCT\n    x : INT;\n  END_STRUCT;\n  B : (Y);\nEND_TYPE\n')).toMatch(
      /exactly one data type/,
    )
  })

  it('rejects a structure without END_STRUCT, naming the token it wanted', () => {
    expect(errorFor('TYPE\n  P : STRUCT\n    x : INT;\nEND_TYPE\n')).toMatch(/END_STRUCT/)
  })

  it('rejects a field missing its semicolon', () => {
    expect(errorFor('TYPE\n  P : STRUCT\n    x : INT\n  END_STRUCT;\nEND_TYPE\n')).toMatch(/Semicolon/)
  })

  it('rejects a field missing its colon', () => {
    expect(errorFor('TYPE\n  P : STRUCT\n    x INT;\n  END_STRUCT;\nEND_TYPE\n')).toBeTruthy()
  })

  it('rejects a two-word field type', () => {
    expect(errorFor('TYPE\n  P : STRUCT\n    x : MY TYPE;\n  END_STRUCT;\nEND_TYPE\n')).toBeTruthy()
  })

  it('rejects a structure field whose ARRAY has a blank bound', () => {
    expect(errorFor('TYPE\n  P : STRUCT\n    m : ARRAY[0..1,] OF INT;\n  END_STRUCT;\nEND_TYPE\n')).toMatch(
      /ARRAY dimension/,
    )
    expect(errorFor('TYPE\n  P : STRUCT\n    m : ARRAY[0..1,,0..2] OF INT;\n  END_STRUCT;\nEND_TYPE\n')).toMatch(
      /ARRAY dimension/,
    )
  })

  it('rejects an enumeration value that is not an identifier', () => {
    expect(errorFor('TYPE\n  Color : (Red, 2bad);\nEND_TYPE\n')).toMatch(/Identifier/)
  })

  it('rejects a structure field name that is not an identifier', () => {
    expect(errorFor('TYPE\n  P : STRUCT\n    2bad : INT;\nEND_STRUCT;\nEND_TYPE\n')).toBeTruthy()
  })

  it('rejects a reserved word as a field name', () => {
    expect(errorFor('TYPE\n  P : STRUCT\n    IF : INT;\n  END_STRUCT;\nEND_TYPE\n')).toBeTruthy()
  })

  it('rejects a type name that is not an identifier', () => {
    expect(errorFor('TYPE\n  2bad : (Red);\nEND_TYPE\n')).toBeTruthy()
  })

  it('refuses an alias type, which the editor model cannot represent', () => {
    // `MyInt : INT;` is legal IEC but the editor knows only structures,
    // enumerations and arrays. Saying so beats inventing a one-field structure
    // the user never wrote.
    expect(errorFor('TYPE\n  MyInt : INT;\nEND_TYPE\n')).toMatch(/alias for another type/)
  })
})
