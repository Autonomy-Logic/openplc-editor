import type { PLCDataType, PLCPou } from '../../../middleware/shared/ports/types'
import { openPLCStoreBase } from '../../store'
import {
  findFunctionBlockVariables,
  findLeafVariables,
  findStructureVariables,
  getPouVariables,
  isBaseType,
  isEnumerationType,
  isFunctionBlockType,
  isStructureType,
  normalizeTypeString,
} from '../pou-helpers'

/** Bundled system libraries — pre-populated by `jest-vi-shim.ts`
 *  reading the same `node_modules/strucpp/libs/*.stlib` archives the
 *  runtime loads.  Helpers used to read this directly from the store;
 *  the refactor passes it through as an explicit param so utils don't
 *  cross the store boundary (arch validator forbids utils → store). */
const SYSTEM_LIBS = openPLCStoreBase.getState().libraries.system

// ---------------------------------------------------------------------------
// normalizeTypeString
// ---------------------------------------------------------------------------

describe('normalizeTypeString', () => {
  it('lowercases the string', () => {
    expect(normalizeTypeString('BOOL')).toBe('bool')
  })

  it('removes hyphens and underscores', () => {
    expect(normalizeTypeString('function-block')).toBe('functionblock')
    expect(normalizeTypeString('function_block')).toBe('functionblock')
    expect(normalizeTypeString('Function-Block')).toBe('functionblock')
  })

  it('handles empty string', () => {
    expect(normalizeTypeString('')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// isBaseType
// ---------------------------------------------------------------------------

describe('isBaseType', () => {
  it('returns true for all base types (case-insensitive)', () => {
    const types = [
      'BOOL',
      'SINT',
      'INT',
      'DINT',
      'LINT',
      'USINT',
      'UINT',
      'UDINT',
      'ULINT',
      'REAL',
      'LREAL',
      'TIME',
      'DATE',
      'TOD',
      'DT',
      'STRING',
      'BYTE',
      'WORD',
      'DWORD',
      'LWORD',
    ]
    types.forEach((t) => {
      expect(isBaseType(t)).toBe(true)
      expect(isBaseType(t.toLowerCase())).toBe(true)
    })
  })

  it('returns false for non-base types', () => {
    expect(isBaseType('TON')).toBe(false)
    expect(isBaseType('MY_STRUCT')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// findFunctionBlockVariables
// ---------------------------------------------------------------------------

describe('findFunctionBlockVariables', () => {
  it('finds a standard library function block by name (case-insensitive)', () => {
    // SR is a standard FB
    const vars = findFunctionBlockVariables('sr', [], SYSTEM_LIBS)
    expect(vars).not.toBeNull()
    expect(Array.isArray(vars)).toBe(true)
  })

  it('returns null for unknown function block names', () => {
    expect(findFunctionBlockVariables('NonExistentFB', [], SYSTEM_LIBS)).toBeNull()
  })

  it('finds a project-defined function-block POU', () => {
    const customFB: PLCPou = {
      name: 'MyCustomFB',
      pouType: 'function-block',
      interface: {
        variables: [{ name: 'in1', type: { definition: 'base-type', value: 'INT' }, location: '', documentation: '' }],
      },
      body: { language: 'st', value: '' },
    }
    const vars = findFunctionBlockVariables('MYCUSTOMFB', [customFB], SYSTEM_LIBS)
    expect(vars).not.toBeNull()
    expect(vars!.length).toBe(1)
  })

  it('returns empty array when custom FB has no interface', () => {
    const customFB: PLCPou = {
      name: 'EmptyFB',
      pouType: 'function-block',
      body: { language: 'st', value: '' },
    }
    const vars = findFunctionBlockVariables('EmptyFB', [customFB], SYSTEM_LIBS)
    expect(vars).not.toBeNull()
    expect(vars).toEqual([])
  })

  it('does not match a program POU', () => {
    const prog: PLCPou = {
      name: 'MyProg',
      pouType: 'program',
      interface: { variables: [] },
      body: { language: 'st', value: '' },
    }
    expect(findFunctionBlockVariables('MyProg', [prog], SYSTEM_LIBS)).toBeNull()
  })

  // STruC++ debug-table-gen treats library FBs as black boxes — only
  // their interface (input/output/inOut) ends up in debug-map.json,
  // so the editor must not surface library FB locals to the debugger
  // watch panel or the OPC-UA variable picker either. Same contract.
  it('returns ONLY interface vars for a library FB (no locals)', () => {
    // TON has class:'local' members STATE, PREV_IN, CURRENT_TIME,
    // START_TIME — those must not appear.
    const ton = findFunctionBlockVariables('TON', [], SYSTEM_LIBS)
    expect(ton).not.toBeNull()
    const names = ton!.map((v) => v.name.toUpperCase())
    expect(names).toEqual(expect.arrayContaining(['IN', 'PT', 'Q', 'ET']))
    expect(names).not.toContain('STATE')
    expect(names).not.toContain('PREV_IN')
    expect(names).not.toContain('CURRENT_TIME')
    expect(names).not.toContain('START_TIME')
    // Sanity: every returned var has class in {input, output, inOut}.
    for (const v of ton!) {
      expect(['input', 'output', 'inOut']).toContain(v.class)
    }
  })

  it('keeps locals for user-defined FBs but drops temp/external', () => {
    const customFB: PLCPou = {
      name: 'MyFB',
      pouType: 'function-block',
      interface: {
        variables: [
          {
            name: 'IN',
            class: 'input',
            type: { definition: 'base-type', value: 'BOOL' },
            location: '',
            documentation: '',
          },
          {
            name: 'OUT',
            class: 'output',
            type: { definition: 'base-type', value: 'BOOL' },
            location: '',
            documentation: '',
          },
          {
            name: 'STATE',
            class: 'local',
            type: { definition: 'base-type', value: 'INT' },
            location: '',
            documentation: '',
          },
          {
            name: 'TMP',
            class: 'temp',
            type: { definition: 'base-type', value: 'INT' },
            location: '',
            documentation: '',
          },
          {
            name: 'EXT_REF',
            class: 'external',
            type: { definition: 'base-type', value: 'INT' },
            location: '',
            documentation: '',
          },
        ],
      },
      body: { language: 'st', value: '' },
    }
    const vars = findFunctionBlockVariables('MyFB', [customFB], SYSTEM_LIBS)
    expect(vars).not.toBeNull()
    const names = vars!.map((v) => v.name)
    expect(names).toEqual(['IN', 'OUT', 'STATE'])
    expect(names).not.toContain('TMP')
    expect(names).not.toContain('EXT_REF')
  })
})

// ---------------------------------------------------------------------------
// isFunctionBlockType
// ---------------------------------------------------------------------------

describe('isFunctionBlockType', () => {
  it('returns true for known FB types', () => {
    expect(isFunctionBlockType('SR', [], SYSTEM_LIBS)).toBe(true)
  })

  it('returns false for non-FB types', () => {
    expect(isFunctionBlockType('INT', [], SYSTEM_LIBS)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// findStructureVariables
// ---------------------------------------------------------------------------

describe('findStructureVariables', () => {
  const dataTypes: PLCDataType[] = [
    {
      name: 'MyStruct',
      derivation: 'structure',
      variable: [
        { name: 'field1', type: { definition: 'base-type', value: 'INT' } },
        { name: 'field2', type: { definition: 'base-type', value: 'BOOL' } },
      ],
    },
    {
      name: 'MyEnum',
      derivation: 'enumerated',
      values: [{ description: 'A' }],
    },
  ]

  it('returns variables for a matching structure (case-insensitive)', () => {
    const vars = findStructureVariables('mystruct', dataTypes)
    expect(vars).not.toBeNull()
    expect(vars!.length).toBe(2)
  })

  it('returns null for an enumerated data type', () => {
    expect(findStructureVariables('MyEnum', dataTypes)).toBeNull()
  })

  it('returns null for unknown type name', () => {
    expect(findStructureVariables('UnknownType', dataTypes)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// isStructureType
// ---------------------------------------------------------------------------

describe('isStructureType', () => {
  it('returns true for structures', () => {
    const dt: PLCDataType[] = [{ name: 'S', derivation: 'structure', variable: [] }]
    expect(isStructureType('S', dt)).toBe(true)
  })

  it('returns false for non-structures', () => {
    expect(isStructureType('Unknown', [])).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isEnumerationType
// ---------------------------------------------------------------------------

describe('isEnumerationType', () => {
  const dataTypes: PLCDataType[] = [
    {
      name: 'Color',
      derivation: 'enumerated',
      values: [{ description: 'Red' }, { description: 'Green' }],
    },
    {
      name: 'S1',
      derivation: 'structure',
      variable: [],
    },
  ]

  it('returns true for enumerated types (case-insensitive)', () => {
    expect(isEnumerationType('color', dataTypes)).toBe(true)
    expect(isEnumerationType('COLOR', dataTypes)).toBe(true)
  })

  it('returns false for structure types', () => {
    expect(isEnumerationType('S1', dataTypes)).toBe(false)
  })

  it('returns false for unknown types', () => {
    expect(isEnumerationType('Unknown', dataTypes)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// findLeafVariables
// ---------------------------------------------------------------------------

describe('findLeafVariables', () => {
  const emptyPous: PLCPou[] = []
  const emptyDataTypes: PLCDataType[] = []

  it('returns a single leaf for a base type', () => {
    const leaves = findLeafVariables('BOOL', emptyPous, emptyDataTypes, SYSTEM_LIBS, 'myVar')
    expect(leaves).toEqual([{ relativePath: 'myVar', typeName: 'BOOL' }])
  })

  it('returns empty array for unknown non-base type', () => {
    const leaves = findLeafVariables('UnknownType', emptyPous, emptyDataTypes, SYSTEM_LIBS)
    expect(leaves).toEqual([])
  })

  it('expands a standard library FB into leaf variables', () => {
    // SR has base-type variables (S1, R, Q1 are BOOL)
    const leaves = findLeafVariables('SR', emptyPous, emptyDataTypes, SYSTEM_LIBS, 'mySR')
    expect(leaves.length).toBeGreaterThan(0)
    leaves.forEach((leaf) => {
      expect(leaf.relativePath).toMatch(/^mySR\./)
      expect(typeof leaf.typeName).toBe('string')
    })
  })

  it('expands a structure type into leaf variables', () => {
    const dataTypes: PLCDataType[] = [
      {
        name: 'Point',
        derivation: 'structure',
        variable: [
          { name: 'x', type: { definition: 'base-type', value: 'INT' } },
          { name: 'y', type: { definition: 'base-type', value: 'INT' } },
        ],
      },
    ]
    const leaves = findLeafVariables('Point', emptyPous, dataTypes, SYSTEM_LIBS, 'p')
    expect(leaves).toEqual([
      { relativePath: 'p.x', typeName: 'INT' },
      { relativePath: 'p.y', typeName: 'INT' },
    ])
  })

  it('recursively expands nested structures', () => {
    const dataTypes: PLCDataType[] = [
      {
        name: 'Inner',
        derivation: 'structure',
        variable: [{ name: 'val', type: { definition: 'base-type', value: 'REAL' } }],
      },
      {
        name: 'Outer',
        derivation: 'structure',
        variable: [{ name: 'inner', type: { definition: 'user-data-type', value: 'Inner' } }],
      },
    ]
    const leaves = findLeafVariables('Outer', emptyPous, dataTypes, SYSTEM_LIBS, 'o')
    expect(leaves).toEqual([{ relativePath: 'o.inner.val', typeName: 'REAL' }])
  })

  it('handles circular type references without infinite recursion', () => {
    // A structure that references itself
    const dataTypes: PLCDataType[] = [
      {
        name: 'Circular',
        derivation: 'structure',
        variable: [
          { name: 'self', type: { definition: 'user-data-type', value: 'Circular' } },
          { name: 'val', type: { definition: 'base-type', value: 'INT' } },
        ],
      },
    ]
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const leaves = findLeafVariables('Circular', emptyPous, dataTypes, SYSTEM_LIBS)
    expect(leaves).toEqual([{ relativePath: 'val', typeName: 'INT' }])
    consoleSpy.mockRestore()
  })

  it('skips enumeration-typed fields in FBs', () => {
    const dataTypes: PLCDataType[] = [
      {
        name: 'MyEnum',
        derivation: 'enumerated',
        values: [{ description: 'A' }],
      },
    ]
    const pous: PLCPou[] = [
      {
        name: 'CustomFB',
        pouType: 'function-block',
        interface: {
          variables: [
            {
              name: 'state',
              class: 'local',
              type: { definition: 'user-data-type', value: 'MyEnum' },
              location: '',
              documentation: '',
            },
            {
              name: 'out',
              class: 'output',
              type: { definition: 'base-type', value: 'BOOL' },
              location: '',
              documentation: '',
            },
          ],
        },
        body: { language: 'st', value: '' },
      },
    ]
    const leaves = findLeafVariables('CustomFB', pous, dataTypes, SYSTEM_LIBS, 'fb')
    expect(leaves).toEqual([{ relativePath: 'fb.out', typeName: 'BOOL' }])
  })

  it('skips enumeration-typed fields in structures', () => {
    const dataTypes: PLCDataType[] = [
      {
        name: 'MyEnum',
        derivation: 'enumerated',
        values: [{ description: 'X' }],
      },
      {
        name: 'WithEnum',
        derivation: 'structure',
        variable: [
          { name: 'e', type: { definition: 'user-data-type', value: 'MyEnum' } },
          { name: 'v', type: { definition: 'base-type', value: 'INT' } },
        ],
      },
    ]
    const leaves = findLeafVariables('WithEnum', emptyPous, dataTypes, SYSTEM_LIBS, 's')
    expect(leaves).toEqual([{ relativePath: 's.v', typeName: 'INT' }])
  })

  it('recursively expands nested structure fields within FBs (lines 178-179)', () => {
    const dataTypes: PLCDataType[] = [
      {
        name: 'InnerStruct',
        derivation: 'structure',
        variable: [{ name: 'val', type: { definition: 'base-type', value: 'REAL' } }],
      },
    ]
    const pous: PLCPou[] = [
      {
        name: 'NestedFB',
        pouType: 'function-block',
        interface: {
          variables: [
            {
              name: 'inner',
              class: 'local',
              type: { definition: 'user-data-type', value: 'InnerStruct' },
              location: '',
              documentation: '',
            },
            {
              name: 'out',
              class: 'output',
              type: { definition: 'base-type', value: 'BOOL' },
              location: '',
              documentation: '',
            },
          ],
        },
        body: { language: 'st', value: '' },
      },
    ]
    const leaves = findLeafVariables('NestedFB', pous, dataTypes, SYSTEM_LIBS, 'fb')
    expect(leaves).toEqual([
      { relativePath: 'fb.inner.val', typeName: 'REAL' },
      { relativePath: 'fb.out', typeName: 'BOOL' },
    ])
  })

  it('skips array-typed fields in FBs', () => {
    const pous: PLCPou[] = [
      {
        name: 'ArrayFB',
        pouType: 'function-block',
        interface: {
          variables: [
            {
              name: 'arr',
              class: 'local',
              type: {
                definition: 'array',
                value: 'ARRAY[0..9] OF INT',
                data: {
                  baseType: { definition: 'base-type', value: 'INT' },
                  dimensions: [{ dimension: '0..9' }],
                },
              },
              location: '',
              documentation: '',
            },
            {
              name: 'flag',
              class: 'output',
              type: { definition: 'base-type', value: 'BOOL' },
              location: '',
              documentation: '',
            },
          ],
        },
        body: { language: 'st', value: '' },
      },
    ]
    const leaves = findLeafVariables('ArrayFB', pous, emptyDataTypes, SYSTEM_LIBS, 'fb')
    expect(leaves).toEqual([{ relativePath: 'fb.flag', typeName: 'BOOL' }])
  })

  it('expands a standard library FB with empty pathPrefix (line 168 falsy arm)', () => {
    // SR is a standard FB. Calling without pathPrefix exercises the fbVar.name branch.
    const leaves = findLeafVariables('SR', emptyPous, emptyDataTypes, SYSTEM_LIBS)
    expect(leaves.length).toBeGreaterThan(0)
    // Without pathPrefix, paths should NOT have a leading dot
    leaves.forEach((leaf) => {
      expect(leaf.relativePath).not.toMatch(/^\./)
    })
  })

  it('uses empty pathPrefix by default', () => {
    const dataTypes: PLCDataType[] = [
      {
        name: 'Simple',
        derivation: 'structure',
        variable: [{ name: 'a', type: { definition: 'base-type', value: 'BOOL' } }],
      },
    ]
    const leaves = findLeafVariables('Simple', emptyPous, dataTypes, SYSTEM_LIBS)
    expect(leaves).toEqual([{ relativePath: 'a', typeName: 'BOOL' }])
  })
})

// ---------------------------------------------------------------------------
// getPouVariables
// ---------------------------------------------------------------------------

describe('getPouVariables', () => {
  it('returns variables for a program POU', () => {
    const pou: PLCPou = {
      name: 'P1',
      pouType: 'program',
      interface: {
        variables: [{ name: 'v1', type: { definition: 'base-type', value: 'INT' }, location: '', documentation: '' }],
      },
      body: { language: 'st', value: '' },
    }
    const vars = getPouVariables(pou)
    expect(vars.length).toBe(1)
    expect(vars[0].name).toBe('v1')
  })

  it('returns variables for a function-block POU', () => {
    const pou: PLCPou = {
      name: 'FB1',
      pouType: 'function-block',
      interface: {
        variables: [{ name: 'in1', type: { definition: 'base-type', value: 'BOOL' }, location: '', documentation: '' }],
      },
      body: { language: 'st', value: '' },
    }
    const vars = getPouVariables(pou)
    expect(vars.length).toBe(1)
  })

  it('returns empty array for a function POU', () => {
    const pou: PLCPou = {
      name: 'F1',
      pouType: 'function',
      interface: {
        returnType: 'INT',
        variables: [{ name: 'x', type: { definition: 'base-type', value: 'INT' }, location: '', documentation: '' }],
      },
      body: { language: 'st', value: '' },
    }
    expect(getPouVariables(pou)).toEqual([])
  })

  it('returns empty array when POU has no interface', () => {
    const pou: PLCPou = {
      name: 'P1',
      pouType: 'program',
      body: { language: 'st', value: '' },
    }
    expect(getPouVariables(pou)).toEqual([])
  })
})
