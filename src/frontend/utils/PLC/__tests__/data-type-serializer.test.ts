// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Tests for the data-type serialiser used by the LSP sync layer.
 *
 * Two surfaces under test: `serializeDataTypesToST` produces the
 * `TYPE…END_TYPE` block strucpp parses, and `serializeDataTypesToLines`
 * returns the per-entry line spans that `goto-definition-redirect`
 * relies on to map an LSP line back to a `PLCDataType`.  Both come
 * from the same renderer so a regression in either surface lights
 * one of these up.
 */
import type { PLCDataType } from '../../../../middleware/shared/ports/types'
import { serializeDataTypesToLines, serializeDataTypesToST } from '../data-type-serializer'

const enumerated = (name: string, values: string[], initialValue?: string): PLCDataType => ({
  name,
  derivation: 'enumerated',
  values: values.map((description) => ({ description })),
  ...(initialValue !== undefined ? { initialValue } : {}),
})

const structure = (name: string, fields: { name: string; type: string; initial?: string }[]): PLCDataType => ({
  name,
  derivation: 'structure',
  variable: fields.map((f) => ({
    name: f.name,
    type: { definition: 'base-type', value: f.type },
    ...(f.initial !== undefined ? { initialValue: { simpleValue: { value: f.initial } } } : {}),
  })),
})

const array = (name: string, baseType: string, dimensions: string[], initialValue?: string): PLCDataType => ({
  name,
  derivation: 'array',
  baseType: { definition: 'base-type', value: baseType },
  dimensions: dimensions.map((dimension) => ({ dimension })),
  ...(initialValue !== undefined ? { initialValue } : {}),
})

describe('serializeDataTypesToST', () => {
  it('returns an empty string when the project has no data types', () => {
    expect(serializeDataTypesToST([])).toBe('')
  })

  it('serialises an enumerated type without an initial value', () => {
    const out = serializeDataTypesToST([enumerated('Color', ['Red', 'Green', 'Blue'])])
    expect(out).toBe('TYPE\n  Color : (Red, Green, Blue);\nEND_TYPE\n')
  })

  it('emits := <initial> when an enumerated declares one', () => {
    const out = serializeDataTypesToST([enumerated('Color', ['Red', 'Green'], 'Red')])
    expect(out).toBe('TYPE\n  Color : (Red, Green) := Red;\nEND_TYPE\n')
  })

  it('serialises a structure across multiple lines', () => {
    const out = serializeDataTypesToST([
      structure('Point', [
        { name: 'x', type: 'INT' },
        { name: 'y', type: 'INT' },
      ]),
    ])
    expect(out).toBe(
      'TYPE\n' + '  Point : STRUCT\n' + '    x : INT;\n' + '    y : INT;\n' + '  END_STRUCT;\n' + 'END_TYPE\n',
    )
  })

  it('includes := <initial> for structure fields that carry one', () => {
    const out = serializeDataTypesToST([
      structure('Config', [
        { name: 'rate', type: 'INT', initial: '100' },
        { name: 'enabled', type: 'BOOL' },
      ]),
    ])
    expect(out).toBe(
      'TYPE\n' +
        '  Config : STRUCT\n' +
        '    rate : INT := 100;\n' +
        '    enabled : BOOL;\n' +
        '  END_STRUCT;\n' +
        'END_TYPE\n',
    )
  })

  it('serialises a single-dimension array', () => {
    const out = serializeDataTypesToST([array('Buffer', 'INT', ['0..9'])])
    expect(out).toBe('TYPE\n  Buffer : ARRAY [0..9] OF INT;\nEND_TYPE\n')
  })

  it('serialises a multi-dimension array with an initial value', () => {
    const out = serializeDataTypesToST([array('Matrix', 'REAL', ['0..3', '0..3'], '[0,0,0,0]')])
    expect(out).toBe('TYPE\n  Matrix : ARRAY [0..3][0..3] OF REAL := [0,0,0,0];\nEND_TYPE\n')
  })

  it('packs multiple entries in one block in declaration order', () => {
    const out = serializeDataTypesToST([
      enumerated('Color', ['Red', 'Green']),
      structure('Point', [{ name: 'x', type: 'INT' }]),
      array('Buffer', 'BOOL', ['1..8']),
    ])
    expect(out).toBe(
      'TYPE\n' +
        '  Color : (Red, Green);\n' +
        '  Point : STRUCT\n' +
        '    x : INT;\n' +
        '  END_STRUCT;\n' +
        '  Buffer : ARRAY [1..8] OF BOOL;\n' +
        'END_TYPE\n',
    )
  })

  it('skips entries whose derivation does not render to any line', () => {
    // Future derivations or malformed records render to []; the
    // serialiser drops them without throwing so an unknown shape
    // doesn't take the whole LSP sync down with it.
    const unknown = { name: 'Mystery', derivation: 'pointer' } as unknown as PLCDataType
    expect(serializeDataTypesToST([unknown])).toBe('')
    expect(serializeDataTypesToST([enumerated('Color', ['Red']), unknown])).toBe('TYPE\n  Color : (Red);\nEND_TYPE\n')
  })
})

describe('serializeDataTypesToLines', () => {
  it('returns an empty array for an empty input', () => {
    expect(serializeDataTypesToLines([])).toEqual([])
  })

  it('reports a single line for an enumerated entry', () => {
    const entries = serializeDataTypesToLines([enumerated('Color', ['Red', 'Green'])])
    expect(entries).toEqual([{ name: 'Color', lines: ['  Color : (Red, Green);'] }])
  })

  it('reports declaration + N fields + END_STRUCT for a structure', () => {
    const entries = serializeDataTypesToLines([
      structure('Point', [
        { name: 'x', type: 'INT' },
        { name: 'y', type: 'INT' },
      ]),
    ])
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('Point')
    expect(entries[0].lines).toHaveLength(4)
    expect(entries[0].lines[0]).toBe('  Point : STRUCT')
    expect(entries[0].lines[3]).toBe('  END_STRUCT;')
  })

  it('reports a single line for an array (regardless of dimensions)', () => {
    const entries = serializeDataTypesToLines([array('Buffer', 'INT', ['0..9', '0..3'])])
    expect(entries).toEqual([{ name: 'Buffer', lines: ['  Buffer : ARRAY [0..9][0..3] OF INT;'] }])
  })

  it('drops zero-line entries from the result', () => {
    const unknown = { name: 'Mystery', derivation: 'pointer' } as unknown as PLCDataType
    const entries = serializeDataTypesToLines([unknown, enumerated('Color', ['Red'])])
    expect(entries).toEqual([{ name: 'Color', lines: ['  Color : (Red);'] }])
  })

  it('lines from serializeDataTypesToLines roundtrip into serializeDataTypesToST', () => {
    // Lock the invariant: the flat ST output is exactly TYPE +
    // join(lines, '\n') + END_TYPE.  goto-definition-redirect
    // walks the same line counts to find which data type owns an
    // LSP line, so if the join here ever changes (extra blank
    // separators, etc.) the redirect would silently misroute.
    const dataTypes: PLCDataType[] = [enumerated('Color', ['Red']), structure('Point', [{ name: 'x', type: 'INT' }])]
    const flat = serializeDataTypesToST(dataTypes)
    const entries = serializeDataTypesToLines(dataTypes)
    const reconstructed = `TYPE\n${entries.flatMap((e) => e.lines).join('\n')}\nEND_TYPE\n`
    expect(reconstructed).toBe(flat)
  })
})
