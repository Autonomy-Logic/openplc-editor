import type { PLCDataType, PLCPou, PLCVariable, PLCVariableType } from '../../../middleware/shared/ports/types'
import {
  findAllReferencesToDataType,
  GLOBAL_VARIABLES_CONTAINER,
  renameDataTypeInDataType,
  renameDataTypeInVariableType,
  variableTypeReferencesDataType,
} from '../data-type-references'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const directType = (typeName: string): PLCVariableType => ({ definition: 'user-data-type', value: typeName })

const arrayType = (typeName: string, dimensions: string[] = ['0..4']): PLCVariableType => ({
  definition: 'array',
  value: `ARRAY [${dimensions.join(', ')}] OF ${typeName}`,
  data: {
    baseType: { definition: 'user-data-type', value: typeName },
    dimensions: dimensions.map((dimension) => ({ dimension })),
  },
})

const baseType = (value = 'INT'): PLCVariableType => ({ definition: 'base-type', value })

const makeVariable = (name: string, type: PLCVariableType): PLCVariable => ({
  name,
  class: 'local',
  type,
  location: '',
  documentation: '',
})

const makePou = (name: string, variables: PLCVariable[]): PLCPou => ({
  name,
  pouType: 'program',
  interface: { variables },
  body: { language: 'st', value: '' },
  documentation: '',
})

// ---------------------------------------------------------------------------
// variableTypeReferencesDataType
// ---------------------------------------------------------------------------

describe('variableTypeReferencesDataType', () => {
  it('matches a direct user-data-type reference case-insensitively', () => {
    expect(variableTypeReferencesDataType(directType('MotorDef'), 'MotorDef')).toBe(true)
    expect(variableTypeReferencesDataType(directType('motordef'), 'MotorDef')).toBe(true)
    expect(variableTypeReferencesDataType(directType('Other'), 'MotorDef')).toBe(false)
  })

  it('matches an array base type reference', () => {
    expect(variableTypeReferencesDataType(arrayType('MotorDef'), 'MotorDef')).toBe(true)
    expect(variableTypeReferencesDataType(arrayType('Other'), 'MotorDef')).toBe(false)
  })

  it('ignores arrays without structured data', () => {
    const lossy: PLCVariableType = { definition: 'array', value: 'ARRAY [0..4] OF MotorDef' }
    expect(variableTypeReferencesDataType(lossy, 'MotorDef')).toBe(false)
  })

  it('ignores arrays of base types', () => {
    const ints: PLCVariableType = {
      definition: 'array',
      value: 'ARRAY [0..4] OF INT',
      data: { baseType: { definition: 'base-type', value: 'INT' }, dimensions: [{ dimension: '0..4' }] },
    }
    expect(variableTypeReferencesDataType(ints, 'MotorDef')).toBe(false)
  })

  it('ignores base-type and derived references', () => {
    expect(variableTypeReferencesDataType(baseType(), 'MotorDef')).toBe(false)
    expect(variableTypeReferencesDataType({ definition: 'derived', value: 'MotorDef' }, 'MotorDef')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// findAllReferencesToDataType
// ---------------------------------------------------------------------------

describe('findAllReferencesToDataType', () => {
  const pous: PLCPou[] = [
    makePou('Main', [
      makeVariable('motor', directType('MotorDef')),
      makeVariable('motors', arrayType('motordef')),
      makeVariable('plain', baseType()),
    ]),
    makePou('Aux', [makeVariable('other', directType('Unrelated'))]),
    { name: 'NoInterface', pouType: 'program', body: { language: 'st', value: '' }, documentation: '' },
  ]

  const globalVariables: PLCVariable[] = [
    { ...makeVariable('gMotor', directType('MotorDef')), class: 'global' },
    { ...makeVariable('gPlain', baseType()), class: 'global' },
  ]

  const dataTypes: PLCDataType[] = [
    { name: 'MotorDef', derivation: 'structure', variable: [{ name: 'speed', type: baseType() }] },
    {
      name: 'Chassis',
      derivation: 'structure',
      variable: [
        { name: 'front', type: directType('MotorDef') },
        { name: 'rear', type: arrayType('MotorDef') },
        { name: 'id', type: baseType() },
      ],
    },
    {
      name: 'MotorBank',
      derivation: 'array',
      baseType: directType('MotorDef'),
      initialValue: '',
      dimensions: [{ dimension: '1..8' }],
    },
    { name: 'Mode', derivation: 'enumerated', values: [{ description: 'Auto' }] },
  ]

  it('collects references from POU variables, globals, and other data types', () => {
    const impact = findAllReferencesToDataType('MotorDef', pous, globalVariables, dataTypes)

    expect(impact.totalReferences).toBe(6)
    expect(impact.references).toEqual([
      { kind: 'pou-variable', container: 'Main', variableName: 'motor' },
      { kind: 'pou-variable', container: 'Main', variableName: 'motors' },
      { kind: 'global-variable', container: GLOBAL_VARIABLES_CONTAINER, variableName: 'gMotor' },
      { kind: 'data-type-field', container: 'Chassis', variableName: 'front' },
      { kind: 'data-type-field', container: 'Chassis', variableName: 'rear' },
      { kind: 'data-type-base-type', container: 'MotorBank' },
    ])
  })

  it('aggregates counts by container and by reference kind', () => {
    const impact = findAllReferencesToDataType('MotorDef', pous, globalVariables, dataTypes)

    expect(Array.from(impact.byPou.entries())).toEqual([
      ['Main', 2],
      [GLOBAL_VARIABLES_CONTAINER, 1],
      ['Chassis', 2],
      ['MotorBank', 1],
    ])
    expect(Array.from(impact.byEditorType.entries())).toEqual([
      ['POU variables', 2],
      ['global variables', 1],
      ['data types', 3],
    ])
  })

  it('returns an empty analysis when nothing references the type', () => {
    const impact = findAllReferencesToDataType('Ghost', pous, globalVariables, dataTypes)

    expect(impact.totalReferences).toBe(0)
    expect(impact.byPou.size).toBe(0)
    expect(impact.byEditorType.size).toBe(0)
    expect(impact.references).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// renameDataTypeInVariableType
// ---------------------------------------------------------------------------

describe('renameDataTypeInVariableType', () => {
  it('renames a direct reference and keeps the rest of the type', () => {
    expect(renameDataTypeInVariableType(directType('motordef'), 'MotorDef', 'DriveDef')).toEqual({
      definition: 'user-data-type',
      value: 'DriveDef',
    })
  })

  it('renames an array base type and rebuilds the display value', () => {
    const next = renameDataTypeInVariableType(arrayType('MotorDef', ['0..4', '1..2']), 'MotorDef', 'DriveDef')
    expect(next).toEqual({
      definition: 'array',
      value: 'ARRAY [0..4, 1..2] OF DriveDef',
      data: {
        baseType: { definition: 'user-data-type', value: 'DriveDef' },
        dimensions: [{ dimension: '0..4' }, { dimension: '1..2' }],
      },
    })
  })

  it('returns null for types that do not reference the old name', () => {
    expect(renameDataTypeInVariableType(directType('Other'), 'MotorDef', 'DriveDef')).toBeNull()
    expect(renameDataTypeInVariableType(arrayType('Other'), 'MotorDef', 'DriveDef')).toBeNull()
    expect(renameDataTypeInVariableType(baseType(), 'MotorDef', 'DriveDef')).toBeNull()
    expect(
      renameDataTypeInVariableType({ definition: 'array', value: 'ARRAY [0..4] OF MotorDef' }, 'MotorDef', 'DriveDef'),
    ).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// renameDataTypeInDataType
// ---------------------------------------------------------------------------

describe('renameDataTypeInDataType', () => {
  it('renames only the structure fields that reference the type', () => {
    const chassis: PLCDataType = {
      name: 'Chassis',
      derivation: 'structure',
      variable: [
        { name: 'front', type: directType('MotorDef') },
        { name: 'id', type: baseType() },
      ],
    }
    expect(renameDataTypeInDataType(chassis, 'MotorDef', 'DriveDef')).toEqual({
      name: 'Chassis',
      derivation: 'structure',
      variable: [
        { name: 'front', type: directType('DriveDef') },
        { name: 'id', type: baseType() },
      ],
    })
  })

  it('renames an array data type base type', () => {
    const bank: PLCDataType = {
      name: 'MotorBank',
      derivation: 'array',
      baseType: directType('MotorDef'),
      initialValue: '',
      dimensions: [{ dimension: '1..8' }],
    }
    expect(renameDataTypeInDataType(bank, 'MotorDef', 'DriveDef')).toEqual({
      name: 'MotorBank',
      derivation: 'array',
      baseType: directType('DriveDef'),
      initialValue: '',
      dimensions: [{ dimension: '1..8' }],
    })
  })

  it('returns null when nothing references the type', () => {
    const unrelatedStruct: PLCDataType = {
      name: 'Point',
      derivation: 'structure',
      variable: [{ name: 'x', type: baseType() }],
    }
    const unrelatedArray: PLCDataType = {
      name: 'Ints',
      derivation: 'array',
      baseType: baseType(),
      initialValue: '',
      dimensions: [{ dimension: '0..1' }],
    }
    const mode: PLCDataType = { name: 'Mode', derivation: 'enumerated', values: [{ description: 'Auto' }] }

    expect(renameDataTypeInDataType(unrelatedStruct, 'MotorDef', 'DriveDef')).toBeNull()
    expect(renameDataTypeInDataType(unrelatedArray, 'MotorDef', 'DriveDef')).toBeNull()
    expect(renameDataTypeInDataType(mode, 'MotorDef', 'DriveDef')).toBeNull()
  })
})
