import type { PLCDataType, PLCInstance, PLCPou, PLCVariable } from '../../../middleware/shared/ports/types'
import type { DebugVariableEntry, ParsedDebugData } from '../debug-parser'
import {
  buildDebugVariableTreeMap,
  buildFbInstanceMap,
  buildVariableIndexMap,
  logCompilerEvent,
} from '../debugger-session'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBaseVariable(name: string, baseType: string, cls: PLCVariable['class'] = 'local'): PLCVariable {
  return {
    name,
    class: cls,
    type: { definition: 'base-type', value: baseType },
    location: '',
    documentation: '',
  }
}

function makeDerivedVariable(name: string, typeName: string, cls: PLCVariable['class'] = 'local'): PLCVariable {
  return {
    name,
    class: cls,
    type: { definition: 'derived', value: typeName },
    location: '',
    documentation: '',
  }
}

function makeArrayVariable(
  name: string,
  baseType: string,
  dimension: string,
  cls: PLCVariable['class'] = 'local',
): PLCVariable {
  return {
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
  }
}

function makePou(name: string, pouType: PLCPou['pouType'], vars: PLCVariable[] = []): PLCPou {
  return {
    name,
    pouType,
    interface: { variables: vars },
    body: { language: 'st', value: '' },
  }
}

function makeDebugVar(name: string, type: string, index: number): DebugVariableEntry {
  return { name, type, index }
}

function makeInstance(name: string, program: string, task = 'Task0'): PLCInstance {
  return { name, task, program }
}

/** Simple log collector — NOT jest.fn(), just a plain function with a captured array. */
function createLogCollector() {
  const entries: { id: string; level: string; message: string }[] = []
  const log = (entry: { id: string; level: 'error' | 'debug' | 'info' | 'warning'; message: string }) => {
    entries.push(entry)
  }
  return { entries, log }
}

// ---------------------------------------------------------------------------
// logCompilerEvent
// ---------------------------------------------------------------------------

describe('logCompilerEvent', () => {
  it('logs each non-empty line of the message', () => {
    const { entries, log } = createLogCollector()
    logCompilerEvent({ message: 'line1\nline2\nline3' }, log)

    expect(entries).toHaveLength(3)
    expect(entries[0].message).toBe('line1')
    expect(entries[1].message).toBe('line2')
    expect(entries[2].message).toBe('line3')
  })

  it('skips empty lines', () => {
    const { entries, log } = createLogCollector()
    logCompilerEvent({ message: 'first\n\nsecond\n' }, log)

    expect(entries).toHaveLength(2)
    expect(entries[0].message).toBe('first')
    expect(entries[1].message).toBe('second')
  })

  it('does nothing when message is undefined', () => {
    const { entries, log } = createLogCollector()
    logCompilerEvent({}, log)
    expect(entries).toHaveLength(0)
  })

  it('uses provided level', () => {
    const { entries, log } = createLogCollector()
    logCompilerEvent({ message: 'err', level: 'error' }, log)

    expect(entries[0].level).toBe('error')
  })

  it('defaults to info level when no level provided', () => {
    const { entries, log } = createLogCollector()
    logCompilerEvent({ message: 'msg' }, log)

    expect(entries[0].level).toBe('info')
  })

  it('trims whitespace from message before splitting', () => {
    const { entries, log } = createLogCollector()
    logCompilerEvent({ message: '  hello  ' }, log)

    expect(entries[0].message).toBe('hello')
  })

  it('generates unique IDs for each log entry', () => {
    const { entries, log } = createLogCollector()
    logCompilerEvent({ message: 'a\nb' }, log)

    expect(entries[0].id).toBeTruthy()
    expect(entries[1].id).toBeTruthy()
    expect(entries[0].id).not.toBe(entries[1].id)
  })
})

// ---------------------------------------------------------------------------
// buildVariableIndexMap
// ---------------------------------------------------------------------------

describe('buildVariableIndexMap', () => {
  it('builds index map for simple base-type variables', () => {
    const pou = makePou('Main', 'program', [makeBaseVariable('SPEED', 'INT'), makeBaseVariable('TEMP', 'REAL')])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const parsed: ParsedDebugData = {
      variables: [
        makeDebugVar('RES0__INSTANCE0.SPEED', 'INT_ENUM', 0),
        makeDebugVar('RES0__INSTANCE0.TEMP', 'REAL_ENUM', 1),
      ],
      totalCount: 2,
    }

    const { indexMap, warnings } = buildVariableIndexMap([pou], instances, parsed)

    expect(indexMap.get('Main:SPEED')).toBe(0)
    expect(indexMap.get('Main:TEMP')).toBe(1)
    expect(warnings).toHaveLength(0)
  })

  it('warns when no instance is found for a program POU', () => {
    const pou = makePou('Orphan', 'program', [makeBaseVariable('X', 'INT')])
    const instances: PLCInstance[] = []
    const parsed: ParsedDebugData = { variables: [], totalCount: 0 }

    const { warnings } = buildVariableIndexMap([pou], instances, parsed)

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Orphan')
  })

  it('skips non-program POUs', () => {
    const fb = makePou('MyFB', 'function-block', [makeBaseVariable('Q', 'BOOL')])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const parsed: ParsedDebugData = { variables: [], totalCount: 0 }

    const { indexMap } = buildVariableIndexMap([fb], instances, parsed)

    expect(indexMap.size).toBe(0)
  })

  it('handles external base-type variables using global path', () => {
    const pou = makePou('Main', 'program', [makeBaseVariable('GFLAG', 'BOOL', 'external')])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const parsed: ParsedDebugData = {
      variables: [makeDebugVar('CONFIG0__GFLAG', 'BOOL_ENUM', 5)],
      totalCount: 1,
    }

    const { indexMap } = buildVariableIndexMap([pou], instances, parsed)

    expect(indexMap.get('Main:GFLAG')).toBe(5)
  })

  it('handles array variables with proper element indexing', () => {
    const pou = makePou('Main', 'program', [makeArrayVariable('ARR', 'INT', '0..2')])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const parsed: ParsedDebugData = {
      variables: [
        makeDebugVar('RES0__INSTANCE0.ARR.value.table[0]', 'INT_ENUM', 10),
        makeDebugVar('RES0__INSTANCE0.ARR.value.table[1]', 'INT_ENUM', 11),
        makeDebugVar('RES0__INSTANCE0.ARR.value.table[2]', 'INT_ENUM', 12),
      ],
      totalCount: 3,
    }

    const { indexMap } = buildVariableIndexMap([pou], instances, parsed)

    expect(indexMap.get('Main:ARR[0]')).toBe(10)
    expect(indexMap.get('Main:ARR[1]')).toBe(11)
    expect(indexMap.get('Main:ARR[2]')).toBe(12)
  })

  it('handles external array variables using global path', () => {
    const pou = makePou('Main', 'program', [makeArrayVariable('GARR', 'INT', '1..2', 'external')])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const parsed: ParsedDebugData = {
      variables: [
        makeDebugVar('CONFIG0__GARR.value.table[0]', 'INT_ENUM', 20),
        makeDebugVar('CONFIG0__GARR.value.table[1]', 'INT_ENUM', 21),
      ],
      totalCount: 2,
    }

    const { indexMap } = buildVariableIndexMap([pou], instances, parsed)

    expect(indexMap.get('Main:GARR[1]')).toBe(20)
    expect(indexMap.get('Main:GARR[2]')).toBe(21)
  })

  it('handles arrays with negative start index', () => {
    const pou = makePou('Main', 'program', [makeArrayVariable('NEG', 'BOOL', '-1..1')])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const parsed: ParsedDebugData = {
      variables: [
        makeDebugVar('RES0__INSTANCE0.NEG.value.table[0]', 'BOOL_ENUM', 30),
        makeDebugVar('RES0__INSTANCE0.NEG.value.table[1]', 'BOOL_ENUM', 31),
        makeDebugVar('RES0__INSTANCE0.NEG.value.table[2]', 'BOOL_ENUM', 32),
      ],
      totalCount: 3,
    }

    const { indexMap } = buildVariableIndexMap([pou], instances, parsed)

    expect(indexMap.get('Main:NEG[-1]')).toBe(30)
    expect(indexMap.get('Main:NEG[0]')).toBe(31)
    expect(indexMap.get('Main:NEG[1]')).toBe(32)
  })

  it('skips array elements with null index', () => {
    const pou = makePou('Main', 'program', [makeArrayVariable('ARR', 'INT', '0..0')])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const parsed: ParsedDebugData = { variables: [], totalCount: 0 }

    const { indexMap } = buildVariableIndexMap([pou], instances, parsed)

    expect(indexMap.has('Main:ARR[0]')).toBe(false)
  })

  it('skips non-array variables with null index', () => {
    const pou = makePou('Main', 'program', [makeBaseVariable('MISSING', 'INT')])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const parsed: ParsedDebugData = { variables: [], totalCount: 0 }

    const { indexMap } = buildVariableIndexMap([pou], instances, parsed)

    expect(indexMap.has('Main:MISSING')).toBe(false)
  })

  it('appends unmatched parsed variables as fallback entries', () => {
    const pou = makePou('Main', 'program', [])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const parsed: ParsedDebugData = {
      variables: [makeDebugVar('SOME__UNKNOWN.VAR', 'INT_ENUM', 99)],
      totalCount: 1,
    }

    const { indexMap } = buildVariableIndexMap([pou], instances, parsed)

    expect(indexMap.get('SOME__UNKNOWN.VAR')).toBe(99)
  })

  it('does not overwrite existing entries with fallback entries', () => {
    const pou = makePou('Main', 'program', [makeBaseVariable('X', 'INT')])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const debugVar = makeDebugVar('RES0__INSTANCE0.X', 'INT_ENUM', 0)
    const parsed: ParsedDebugData = {
      variables: [debugVar],
      totalCount: 1,
    }

    const { indexMap } = buildVariableIndexMap([pou], instances, parsed)

    // 'Main:X' was set to 0 first; 'RES0__INSTANCE0.X' is a fallback key
    expect(indexMap.get('Main:X')).toBe(0)
  })

  it('skips fallback entry when the debug variable name already exists in the map', () => {
    // Scenario: composite key matches the debug variable name exactly.
    // We name the pou's variable so that the composite key equals the debug var's name.
    const pou = makePou('Main', 'program', [makeBaseVariable('X', 'INT')])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    // The first debug var sets composite key 'Main:X' -> 0
    // The second debug var has name 'Main:X' which already exists -> should be skipped
    const parsed: ParsedDebugData = {
      variables: [makeDebugVar('RES0__INSTANCE0.X', 'INT_ENUM', 0), makeDebugVar('Main:X', 'INT_ENUM', 99)],
      totalCount: 2,
    }

    const { indexMap } = buildVariableIndexMap([pou], instances, parsed)

    // 'Main:X' was set to 0 by the composite key, so the fallback with value 99 is skipped
    expect(indexMap.get('Main:X')).toBe(0)
  })

  it('handles POUs with no interface', () => {
    const pou: PLCPou = {
      name: 'Empty',
      pouType: 'program',
      body: { language: 'st', value: '' },
    }
    const instances = [makeInstance('INSTANCE0', 'Empty')]
    const parsed: ParsedDebugData = { variables: [], totalCount: 0 }

    const { indexMap, warnings } = buildVariableIndexMap([pou], instances, parsed)
    expect(indexMap.size).toBe(0)
    expect(warnings).toHaveLength(0)
  })

  it('skips array variables with invalid dimension format', () => {
    const pou = makePou('Main', 'program', [
      {
        name: 'BAD',
        class: 'local',
        type: {
          definition: 'array',
          value: 'ARRAY',
          data: {
            baseType: { definition: 'base-type', value: 'INT' },
            dimensions: [{ dimension: 'bad' }],
          },
        },
        location: '',
        documentation: '',
      },
    ])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const parsed: ParsedDebugData = { variables: [], totalCount: 0 }

    const { indexMap } = buildVariableIndexMap([pou], instances, parsed)
    expect(indexMap.has('Main:BAD[0]')).toBe(false)
  })

  it('skips array variables with no dimensions', () => {
    const pou = makePou('Main', 'program', [
      {
        name: 'EMPTY_ARR',
        class: 'local',
        type: {
          definition: 'array',
          value: 'ARRAY',
          data: {
            baseType: { definition: 'base-type', value: 'INT' },
            dimensions: [],
          },
        },
        location: '',
        documentation: '',
      },
    ])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const parsed: ParsedDebugData = { variables: [], totalCount: 0 }

    const { indexMap } = buildVariableIndexMap([pou], instances, parsed)
    expect(indexMap.size).toBe(0)
  })

  it('handles external array elements that are not found (null match)', () => {
    const pou = makePou('Main', 'program', [makeArrayVariable('EXT_ARR', 'INT', '0..1', 'external')])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    // Only provide index for element [0], not [1]
    const parsed: ParsedDebugData = {
      variables: [makeDebugVar('CONFIG0__EXT_ARR.value.table[0]', 'INT_ENUM', 50)],
      totalCount: 1,
    }

    const { indexMap } = buildVariableIndexMap([pou], instances, parsed)
    expect(indexMap.get('Main:EXT_ARR[0]')).toBe(50)
    expect(indexMap.has('Main:EXT_ARR[1]')).toBe(false)
  })

  it('does not duplicate fallback entries that already exist', () => {
    const pou = makePou('Main', 'program', [makeBaseVariable('X', 'INT')])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const debugVar = makeDebugVar('RES0__INSTANCE0.X', 'INT_ENUM', 0)
    const parsed: ParsedDebugData = {
      variables: [debugVar],
      totalCount: 1,
    }

    const { indexMap } = buildVariableIndexMap([pou], instances, parsed)

    // Main:X was set first (value 0). The debugVar name 'RES0__INSTANCE0.X' should also be in the map
    // as a fallback since it won't match 'Main:X'
    expect(indexMap.get('Main:X')).toBe(0)
    expect(indexMap.get('RES0__INSTANCE0.X')).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// buildDebugVariableTreeMap
// ---------------------------------------------------------------------------

describe('buildDebugVariableTreeMap', () => {
  it('builds tree map for simple base-type variables', () => {
    const pou = makePou('Main', 'program', [makeBaseVariable('X', 'INT'), makeBaseVariable('Y', 'BOOL')])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const debugVars = [
      makeDebugVar('RES0__INSTANCE0.X', 'INT_ENUM', 0),
      makeDebugVar('RES0__INSTANCE0.Y', 'BOOL_ENUM', 1),
    ]
    const projectData = { dataTypes: [] as PLCDataType[], pous: [pou] }

    const { treeMap, trees, complexCount } = buildDebugVariableTreeMap([pou], instances, debugVars, projectData)

    expect(trees).toHaveLength(2)
    expect(treeMap.has('Main:X')).toBe(true)
    expect(treeMap.has('Main:Y')).toBe(true)
    expect(complexCount).toBe(0)
  })

  it('counts complex nodes', () => {
    const pou = makePou('Main', 'program', [makeDerivedVariable('mySR', 'SR')])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const debugVars = [
      makeDebugVar('RES0__INSTANCE0.MYSR.S1', 'BOOL_ENUM', 0),
      makeDebugVar('RES0__INSTANCE0.MYSR.R', 'BOOL_ENUM', 1),
      makeDebugVar('RES0__INSTANCE0.MYSR.Q1', 'BOOL_ENUM', 2),
    ]
    const projectData = { dataTypes: [] as PLCDataType[], pous: [pou] }

    const { complexCount } = buildDebugVariableTreeMap([pou], instances, debugVars, projectData)

    expect(complexCount).toBe(1)
  })

  it('adds children to tree map recursively', () => {
    const pou = makePou('Main', 'program', [makeDerivedVariable('mySR', 'SR')])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const debugVars = [
      makeDebugVar('RES0__INSTANCE0.MYSR.S1', 'BOOL_ENUM', 0),
      makeDebugVar('RES0__INSTANCE0.MYSR.R', 'BOOL_ENUM', 1),
      makeDebugVar('RES0__INSTANCE0.MYSR.Q1', 'BOOL_ENUM', 2),
    ]
    const projectData = { dataTypes: [] as PLCDataType[], pous: [pou] }

    const { treeMap } = buildDebugVariableTreeMap([pou], instances, debugVars, projectData)

    expect(treeMap.has('Main:mySR')).toBe(true)
    expect(treeMap.has('Main:mySR.S1')).toBe(true)
    expect(treeMap.has('Main:mySR.R')).toBe(true)
    expect(treeMap.has('Main:mySR.Q1')).toBe(true)
  })

  it('skips non-program POUs', () => {
    const fb = makePou('MyFB', 'function-block', [makeBaseVariable('Q', 'BOOL')])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const projectData = { dataTypes: [] as PLCDataType[], pous: [fb] }

    const { trees } = buildDebugVariableTreeMap([fb], instances, [], projectData)

    expect(trees).toHaveLength(0)
  })

  it('skips POUs without matching instance', () => {
    const pou = makePou('Orphan', 'program', [makeBaseVariable('X', 'INT')])
    const instances: PLCInstance[] = []
    const projectData = { dataTypes: [] as PLCDataType[], pous: [pou] }

    const { trees } = buildDebugVariableTreeMap([pou], instances, [], projectData)

    expect(trees).toHaveLength(0)
  })

  it('swallows errors from buildDebugTree and continues', () => {
    // Create a variable that would cause issues but should be swallowed
    const badVar: PLCVariable = {
      name: 'bad',
      class: 'local',
      type: { definition: 'array', value: 'ARRAY' },
      location: '',
      documentation: '',
    }
    const goodVar = makeBaseVariable('good', 'INT')
    const pou = makePou('Main', 'program', [badVar, goodVar])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const debugVars = [makeDebugVar('RES0__INSTANCE0.GOOD', 'INT_ENUM', 0)]
    const projectData = { dataTypes: [] as PLCDataType[], pous: [pou] }

    // Should not throw, should still include the good variable
    const { trees } = buildDebugVariableTreeMap([pou], instances, debugVars, projectData)

    // At minimum the good variable should be present
    const goodTree = trees.find((t) => t.name === 'good')
    expect(goodTree).toBeDefined()
  })

  it('adds _TMP_ debug variables as leaf nodes', () => {
    const pou = makePou('Main', 'program', [])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const debugVars = [
      makeDebugVar('RES0__INSTANCE0._TMP_ADD3_OUT', 'INT_ENUM', 100),
      makeDebugVar('RES0__INSTANCE0._TMP_MUL5_RES', 'REAL_O_ENUM', 101),
      makeDebugVar('RES0__INSTANCE0._TMP_SUB1_X', 'DINT_P_ENUM', 102),
      makeDebugVar('RES0__INSTANCE0._TMP_DIV2_Y', 'LINT_ENUM', 103),
    ]
    const projectData = { dataTypes: [] as PLCDataType[], pous: [pou] }

    const { trees, treeMap } = buildDebugVariableTreeMap([pou], instances, debugVars, projectData)

    expect(trees).toHaveLength(4)
    expect(treeMap.get('Main:_TMP_ADD3_OUT')?.type).toBe('INT')
    expect(treeMap.get('Main:_TMP_MUL5_RES')?.type).toBe('REAL')
    expect(treeMap.get('Main:_TMP_SUB1_X')?.type).toBe('DINT')
    expect(treeMap.get('Main:_TMP_DIV2_Y')?.type).toBe('LINT')
  })

  it('skips debug vars not starting with instance prefix', () => {
    const pou = makePou('Main', 'program', [])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const debugVars = [
      makeDebugVar('CONFIG0__GLOBAL_VAR', 'INT_ENUM', 200),
      makeDebugVar('RES0__INSTANCE1._TMP_X', 'INT_ENUM', 201),
    ]
    const projectData = { dataTypes: [] as PLCDataType[], pous: [pou] }

    const { trees } = buildDebugVariableTreeMap([pou], instances, debugVars, projectData)

    expect(trees).toHaveLength(0)
  })

  it('skips debug vars that do not start with _TMP_ after the instance prefix', () => {
    const pou = makePou('Main', 'program', [])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const debugVars = [makeDebugVar('RES0__INSTANCE0.REGULAR_VAR', 'INT_ENUM', 300)]
    const projectData = { dataTypes: [] as PLCDataType[], pous: [pou] }

    const { trees } = buildDebugVariableTreeMap([pou], instances, debugVars, projectData)

    // REGULAR_VAR is not _TMP_ so it won't be added as a TMP tree node
    expect(trees).toHaveLength(0)
  })

  it('handles _TMP_ variables with type that does not end in _ENUM', () => {
    const pou = makePou('Main', 'program', [])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const debugVars = [makeDebugVar('RES0__INSTANCE0._TMP_FUNC1_OUT', 'CUSTOM_TYPE', 500)]
    const projectData = { dataTypes: [] as PLCDataType[], pous: [pou] }

    const { treeMap } = buildDebugVariableTreeMap([pou], instances, debugVars, projectData)

    // Type name should be kept as-is since it doesn't end in _ENUM
    expect(treeMap.get('Main:_TMP_FUNC1_OUT')?.type).toBe('CUSTOM_TYPE')
  })

  it('handles POUs with no interface', () => {
    const pou: PLCPou = {
      name: 'Empty',
      pouType: 'program',
      body: { language: 'st', value: '' },
    }
    const instances = [makeInstance('INSTANCE0', 'Empty')]
    const projectData = { dataTypes: [] as PLCDataType[], pous: [pou] }

    const { trees } = buildDebugVariableTreeMap([pou], instances, [], projectData)
    expect(trees).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// buildFbInstanceMap
// ---------------------------------------------------------------------------

describe('buildFbInstanceMap', () => {
  it('builds instance map for custom FB derived variables', () => {
    const customFb = makePou('MyFB', 'function-block', [makeBaseVariable('Q', 'BOOL')])
    const program = makePou('Main', 'program', [makeDerivedVariable('inst1', 'MyFB')])
    const instances = [makeInstance('INSTANCE0', 'Main')]

    const result = buildFbInstanceMap([program, customFb], instances)

    expect(result.has('MYFB')).toBe(true)
    const fbInstances = result.get('MYFB')!
    expect(fbInstances).toHaveLength(1)
    expect(fbInstances[0].fbTypeName).toBe('MyFB')
    expect(fbInstances[0].programName).toBe('Main')
    expect(fbInstances[0].programInstanceName).toBe('INSTANCE0')
    expect(fbInstances[0].fbVariableName).toBe('inst1')
    expect(fbInstances[0].key).toBe('Main:inst1')
  })

  it('groups multiple instances of the same FB type', () => {
    const customFb = makePou('MyFB', 'function-block', [])
    const program = makePou('Main', 'program', [makeDerivedVariable('fb1', 'MyFB'), makeDerivedVariable('fb2', 'MyFB')])
    const instances = [makeInstance('INSTANCE0', 'Main')]

    const result = buildFbInstanceMap([program, customFb], instances)

    expect(result.get('MYFB')).toHaveLength(2)
  })

  it('skips non-program POUs', () => {
    const fb = makePou('MyFB', 'function-block', [makeDerivedVariable('inner', 'MyFB')])
    const instances = [makeInstance('INSTANCE0', 'Main')]

    const result = buildFbInstanceMap([fb], instances)

    expect(result.size).toBe(0)
  })

  it('skips program POUs without matching instance', () => {
    const program = makePou('Orphan', 'program', [makeDerivedVariable('fb1', 'MyFB')])
    const instances: PLCInstance[] = []

    const result = buildFbInstanceMap([program], instances)

    expect(result.size).toBe(0)
  })

  it('skips non-derived variables', () => {
    const program = makePou('Main', 'program', [makeBaseVariable('X', 'INT')])
    const instances = [makeInstance('INSTANCE0', 'Main')]

    const result = buildFbInstanceMap([program], instances)

    expect(result.size).toBe(0)
  })

  it('skips derived variables that do not match any custom FB POU', () => {
    // Standard library FBs are not added — only custom FBs where a matching
    // POU with pouType === 'function-block' exists
    const program = makePou('Main', 'program', [makeDerivedVariable('timer', 'TON')])
    const instances = [makeInstance('INSTANCE0', 'Main')]

    const result = buildFbInstanceMap([program], instances)

    expect(result.size).toBe(0)
  })

  it('handles POUs with no interface', () => {
    const program: PLCPou = {
      name: 'Empty',
      pouType: 'program',
      body: { language: 'st', value: '' },
    }
    const instances = [makeInstance('INSTANCE0', 'Empty')]

    const result = buildFbInstanceMap([program], instances)

    expect(result.size).toBe(0)
  })

  it('collects from multiple programs', () => {
    const customFb = makePou('SharedFB', 'function-block', [])
    const prog1 = makePou('Prog1', 'program', [makeDerivedVariable('fb1', 'SharedFB')])
    const prog2 = makePou('Prog2', 'program', [makeDerivedVariable('fb2', 'SharedFB')])
    const instances = [makeInstance('INST0', 'Prog1'), makeInstance('INST1', 'Prog2')]

    const result = buildFbInstanceMap([prog1, prog2, customFb], instances)

    expect(result.get('SHAREDFB')).toHaveLength(2)
  })
})
