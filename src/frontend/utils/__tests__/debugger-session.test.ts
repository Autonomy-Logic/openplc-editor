import type { PLCDataType, PLCInstance, PLCPou, PLCVariable } from '../../../middleware/shared/ports/types'
import { openPLCStoreBase } from '../../store'
import type { DebugMap, DebugVariableEntry } from '../debug-parser'
import { packDebugAddr } from '../debug-parser'
import {
  buildDebugVariableTreeMap,
  buildFbInstanceMap,
  debugMapToEntries,
  deriveVariableIndexMap,
  logCompilerEvent,
} from '../debugger-session'

/** System libraries pre-loaded into the store by `jest-vi-shim.ts`. */
const SYSTEM_LIBS = openPLCStoreBase.getState().libraries.system

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
  const entries: {
    id: string
    level: string
    message: string
    compileError?: import('../../../middleware/shared/ports/types').StructuredCompileError
  }[] = []
  const log = (entry: {
    id: string
    level: 'error' | 'debug' | 'info' | 'warning'
    message: string
    compileError?: import('../../../middleware/shared/ports/types').StructuredCompileError
  }) => {
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

  describe('with compileError attached (structured strucpp diagnostic)', () => {
    const sampleErr = {
      message: 'Cannot assign WSTRING to BOOL',
      line: 9,
      column: 10,
      severity: 'error' as const,
      pouName: 'MANUAL_OVERRIDE',
      pouKind: 'FUNCTION_BLOCK' as const,
      section: 'body' as const,
      bodyLine: 7,
    }

    it('emits a single multi-line entry instead of splitting on newlines', () => {
      const { entries, log } = createLogCollector()
      const multiLine =
        '[MANUAL_OVERRIDE / body line 7]\n' +
        'Manual_Override.st:7:10: error: Cannot assign WSTRING to BOOL\n' +
        '   7 |   asd := "hello world";\n' +
        '     |          ^'
      logCompilerEvent({ message: multiLine, level: 'error', compileError: sampleErr }, log)

      expect(entries).toHaveLength(1)
      expect(entries[0].message).toContain('[MANUAL_OVERRIDE / body line 7]')
      expect(entries[0].message).toContain('asd := "hello world"')
    })

    it('forwards the compileError onto the log entry for click-to-open', () => {
      const { entries, log } = createLogCollector()
      logCompilerEvent({ message: '[X]\nrest', level: 'error', compileError: sampleErr }, log)

      expect(entries[0].compileError).toBe(sampleErr)
    })

    it('still uses the supplied level', () => {
      const { entries, log } = createLogCollector()
      logCompilerEvent({ message: '[X]\nrest', level: 'error', compileError: sampleErr }, log)

      expect(entries[0].level).toBe('error')
    })

    it('returns early when message is undefined even with compileError set', () => {
      const { entries, log } = createLogCollector()
      logCompilerEvent({ compileError: sampleErr }, log)
      expect(entries).toHaveLength(0)
    })
  })
})

// ---------------------------------------------------------------------------
// deriveVariableIndexMap
// ---------------------------------------------------------------------------

function makeMap(leaves: Array<{ path: string; type: string; size: number }>): DebugMap {
  return {
    version: 2,
    md5: 'deadbeef',
    typeTags: { BOOL: 0, INT: 3, REAL: 9, LREAL: 10, DINT: 5 },
    arrays: [{ index: 0, count: leaves.length }],
    leaves: leaves.map((l, i) => ({ arrayIdx: 0, elemIdx: i, ...l })),
  }
}

function addr(arrayIdx: number, elemIdx: number): number {
  return packDebugAddr({ arrayIdx, elemIdx })
}

describe('deriveVariableIndexMap', () => {
  // The index map is now DERIVED from the debug tree (the single enumeration
  // walk) rather than a parallel walk — so these tests drive the real flow:
  // build the tree via buildDebugVariableTreeMap, then derive.
  function derive(
    pous: PLCPou[],
    instances: PLCInstance[],
    map: DebugMap,
    dataTypes: PLCDataType[] = [],
  ): { indexMap: Map<string, number>; warnings: string[] } {
    const entries = debugMapToEntries(map)
    const { treeMap, warnings } = buildDebugVariableTreeMap(pous, instances, entries, { dataTypes, pous }, SYSTEM_LIBS)
    return { indexMap: deriveVariableIndexMap(treeMap, map), warnings }
  }

  it('builds index map for simple base-type variables', () => {
    const pou = makePou('Main', 'program', [makeBaseVariable('SPEED', 'INT'), makeBaseVariable('TEMP', 'REAL')])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const map = makeMap([
      { path: 'INSTANCE0.SPEED', type: 'INT', size: 2 },
      { path: 'INSTANCE0.TEMP', type: 'REAL', size: 4 },
    ])

    const { indexMap, warnings } = derive([pou], instances, map)

    expect(indexMap.get('Main:SPEED')).toBe(addr(0, 0))
    expect(indexMap.get('Main:TEMP')).toBe(addr(0, 1))
    expect(warnings).toHaveLength(0)
  })

  it('warns when no instance is found for a program POU', () => {
    const pou = makePou('Orphan', 'program', [makeBaseVariable('X', 'INT')])
    const { warnings } = derive([pou], [], makeMap([]))

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Orphan')
  })

  it('skips non-program POUs', () => {
    const fb = makePou('MyFB', 'function-block', [makeBaseVariable('Q', 'BOOL')])
    const { indexMap } = derive([fb], [makeInstance('INSTANCE0', 'Main')], makeMap([]))

    expect(indexMap.size).toBe(0)
  })

  it('handles array variables with IEC-indexed element paths', () => {
    const pou = makePou('Main', 'program', [makeArrayVariable('ARR', 'INT', '0..2')])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const map = makeMap([
      { path: 'INSTANCE0.ARR[0]', type: 'INT', size: 2 },
      { path: 'INSTANCE0.ARR[1]', type: 'INT', size: 2 },
      { path: 'INSTANCE0.ARR[2]', type: 'INT', size: 2 },
    ])

    const { indexMap } = derive([pou], instances, map)

    expect(indexMap.get('Main:ARR[0]')).toBe(addr(0, 0))
    expect(indexMap.get('Main:ARR[1]')).toBe(addr(0, 1))
    expect(indexMap.get('Main:ARR[2]')).toBe(addr(0, 2))
  })

  it('handles arrays with negative start index', () => {
    const pou = makePou('Main', 'program', [makeArrayVariable('NEG', 'BOOL', '-1..1')])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const map = makeMap([
      { path: 'INSTANCE0.NEG[-1]', type: 'BOOL', size: 1 },
      { path: 'INSTANCE0.NEG[0]', type: 'BOOL', size: 1 },
      { path: 'INSTANCE0.NEG[1]', type: 'BOOL', size: 1 },
    ])

    const { indexMap } = derive([pou], instances, map)

    expect(indexMap.get('Main:NEG[-1]')).toBe(addr(0, 0))
    expect(indexMap.get('Main:NEG[0]')).toBe(addr(0, 1))
    expect(indexMap.get('Main:NEG[1]')).toBe(addr(0, 2))
  })

  it('resolves VAR_EXTERNAL globals by their bare (unprefixed) debug path', () => {
    // A CONFIGURATION VAR_GLOBAL is emitted under its bare uppercase name, not
    // the program-instance path. The tree resolves the external via the global
    // path, so the composite key gets an index (force/release then work from
    // the LD/FBD editors).
    const pou = makePou('Main', 'program', [
      makeBaseVariable('START_PB', 'BOOL', 'external'),
      makeBaseVariable('LOCAL_X', 'INT'),
    ])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const map = makeMap([
      { path: 'START_PB', type: 'BOOL', size: 1 },
      { path: 'INSTANCE0.LOCAL_X', type: 'INT', size: 2 },
    ])

    const { indexMap } = derive([pou], instances, map)

    expect(indexMap.get('Main:START_PB')).toBe(addr(0, 0))
    expect(indexMap.get('Main:LOCAL_X')).toBe(addr(0, 1))
    // The instance-prefixed path must NOT resolve the global.
    expect(indexMap.has('INSTANCE0.START_PB')).toBe(false)
  })

  it('maps a global shared by two programs to the same index under both keys', () => {
    // The regression this whole refactor targets: a VAR_GLOBAL referenced (as
    // VAR_EXTERNAL) by two programs must resolve to ONE address under BOTH
    // composite keys, so force + value display work on every referencing POU.
    const main = makePou('Main', 'program', [makeBaseVariable('START_PB', 'BOOL', 'external')])
    const another = makePou('Another', 'program', [makeBaseVariable('START_PB', 'BOOL', 'external')])
    const instances = [makeInstance('INSTANCE0', 'Main'), makeInstance('INSTANCE1', 'Another')]
    const map = makeMap([{ path: 'START_PB', type: 'BOOL', size: 1 }])

    const { indexMap } = derive([main, another], instances, map)

    expect(indexMap.get('Main:START_PB')).toBe(addr(0, 0))
    expect(indexMap.get('Another:START_PB')).toBe(addr(0, 0))
  })

  it('falls back to raw debug path for unmatched leaves (nested fields)', () => {
    const pou = makePou('Main', 'program', [])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const map = makeMap([{ path: 'INSTANCE0.FB.FIELD', type: 'INT', size: 2 }])

    const { indexMap } = derive([pou], instances, map)

    expect(indexMap.get('INSTANCE0.FB.FIELD')).toBe(addr(0, 0))
  })

  it('does not lose entries across multiple arrays', () => {
    const pou = makePou('Main', 'program', [makeBaseVariable('X', 'INT')])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const map: DebugMap = {
      version: 2,
      md5: 'deadbeef',
      typeTags: { INT: 3 },
      arrays: [
        { index: 0, count: 1 },
        { index: 1, count: 1 },
      ],
      leaves: [
        { arrayIdx: 0, elemIdx: 0, path: 'INSTANCE0.X', type: 'INT', size: 2 },
        { arrayIdx: 1, elemIdx: 0, path: 'INSTANCE0.OTHER', type: 'INT', size: 2 },
      ],
    }

    const { indexMap } = derive([pou], instances, map)

    expect(indexMap.get('Main:X')).toBe(addr(0, 0))
    expect(indexMap.get('INSTANCE0.OTHER')).toBe(addr(1, 0))
  })
})

// ---------------------------------------------------------------------------
// buildDebugVariableTreeMap
// ---------------------------------------------------------------------------

describe('buildDebugVariableTreeMap', () => {
  it('builds tree map for simple base-type variables', () => {
    const pou = makePou('Main', 'program', [makeBaseVariable('X', 'INT'), makeBaseVariable('Y', 'BOOL')])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const debugVars = [makeDebugVar('INSTANCE0.X', 'INT_ENUM', 0), makeDebugVar('INSTANCE0.Y', 'BOOL_ENUM', 1)]
    const projectData = { dataTypes: [] as PLCDataType[], pous: [pou] }

    const { treeMap, trees, complexCount } = buildDebugVariableTreeMap(
      [pou],
      instances,
      debugVars,
      projectData,
      SYSTEM_LIBS,
    )

    expect(trees).toHaveLength(2)
    expect(treeMap.has('Main:X')).toBe(true)
    expect(treeMap.has('Main:Y')).toBe(true)
    expect(complexCount).toBe(0)
  })

  it('counts complex nodes', () => {
    const pou = makePou('Main', 'program', [makeDerivedVariable('mySR', 'SR')])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const debugVars = [
      makeDebugVar('INSTANCE0.MYSR.S1', 'BOOL_ENUM', 0),
      makeDebugVar('INSTANCE0.MYSR.R', 'BOOL_ENUM', 1),
      makeDebugVar('INSTANCE0.MYSR.Q1', 'BOOL_ENUM', 2),
    ]
    const projectData = { dataTypes: [] as PLCDataType[], pous: [pou] }

    const { complexCount } = buildDebugVariableTreeMap([pou], instances, debugVars, projectData, SYSTEM_LIBS)

    expect(complexCount).toBe(1)
  })

  it('adds children to tree map recursively', () => {
    const pou = makePou('Main', 'program', [makeDerivedVariable('mySR', 'SR')])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const debugVars = [
      makeDebugVar('INSTANCE0.MYSR.S1', 'BOOL_ENUM', 0),
      makeDebugVar('INSTANCE0.MYSR.R', 'BOOL_ENUM', 1),
      makeDebugVar('INSTANCE0.MYSR.Q1', 'BOOL_ENUM', 2),
    ]
    const projectData = { dataTypes: [] as PLCDataType[], pous: [pou] }

    const { treeMap } = buildDebugVariableTreeMap([pou], instances, debugVars, projectData, SYSTEM_LIBS)

    expect(treeMap.has('Main:mySR')).toBe(true)
    expect(treeMap.has('Main:mySR.S1')).toBe(true)
    expect(treeMap.has('Main:mySR.R')).toBe(true)
    expect(treeMap.has('Main:mySR.Q1')).toBe(true)
  })

  it('skips non-program POUs', () => {
    const fb = makePou('MyFB', 'function-block', [makeBaseVariable('Q', 'BOOL')])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const projectData = { dataTypes: [] as PLCDataType[], pous: [fb] }

    const { trees } = buildDebugVariableTreeMap([fb], instances, [], projectData, SYSTEM_LIBS)

    expect(trees).toHaveLength(0)
  })

  it('skips POUs without matching instance', () => {
    const pou = makePou('Orphan', 'program', [makeBaseVariable('X', 'INT')])
    const instances: PLCInstance[] = []
    const projectData = { dataTypes: [] as PLCDataType[], pous: [pou] }

    const { trees } = buildDebugVariableTreeMap([pou], instances, [], projectData, SYSTEM_LIBS)

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
    const debugVars = [makeDebugVar('INSTANCE0.GOOD', 'INT_ENUM', 0)]
    const projectData = { dataTypes: [] as PLCDataType[], pous: [pou] }

    // Should not throw, should still include the good variable
    const { trees } = buildDebugVariableTreeMap([pou], instances, debugVars, projectData, SYSTEM_LIBS)

    // At minimum the good variable should be present
    const goodTree = trees.find((t) => t.name === 'good')
    expect(goodTree).toBeDefined()
  })

  it('adds _TMP_ debug variables as leaf nodes', () => {
    const pou = makePou('Main', 'program', [])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const debugVars = [
      makeDebugVar('INSTANCE0._TMP_ADD3_OUT', 'INT_ENUM', 100),
      makeDebugVar('INSTANCE0._TMP_MUL5_RES', 'REAL_O_ENUM', 101),
      makeDebugVar('INSTANCE0._TMP_SUB1_X', 'DINT_P_ENUM', 102),
      makeDebugVar('INSTANCE0._TMP_DIV2_Y', 'LINT_ENUM', 103),
    ]
    const projectData = { dataTypes: [] as PLCDataType[], pous: [pou] }

    const { trees, treeMap } = buildDebugVariableTreeMap([pou], instances, debugVars, projectData, SYSTEM_LIBS)

    expect(trees).toHaveLength(4)
    expect(treeMap.get('Main:_TMP_ADD3_OUT')?.type).toBe('INT')
    expect(treeMap.get('Main:_TMP_MUL5_RES')?.type).toBe('REAL')
    expect(treeMap.get('Main:_TMP_SUB1_X')?.type).toBe('DINT')
    expect(treeMap.get('Main:_TMP_DIV2_Y')?.type).toBe('LINT')
  })

  it('skips debug vars not starting with instance prefix', () => {
    const pou = makePou('Main', 'program', [])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const debugVars = [makeDebugVar('GLOBAL_VAR', 'INT_ENUM', 200), makeDebugVar('INSTANCE1._TMP_X', 'INT_ENUM', 201)]
    const projectData = { dataTypes: [] as PLCDataType[], pous: [pou] }

    const { trees } = buildDebugVariableTreeMap([pou], instances, debugVars, projectData, SYSTEM_LIBS)

    expect(trees).toHaveLength(0)
  })

  it('skips debug vars that do not start with _TMP_ after the instance prefix', () => {
    const pou = makePou('Main', 'program', [])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const debugVars = [makeDebugVar('INSTANCE0.REGULAR_VAR', 'INT_ENUM', 300)]
    const projectData = { dataTypes: [] as PLCDataType[], pous: [pou] }

    const { trees } = buildDebugVariableTreeMap([pou], instances, debugVars, projectData, SYSTEM_LIBS)

    // REGULAR_VAR is not _TMP_ so it won't be added as a TMP tree node
    expect(trees).toHaveLength(0)
  })

  it('handles _TMP_ variables with type that does not end in _ENUM', () => {
    const pou = makePou('Main', 'program', [])
    const instances = [makeInstance('INSTANCE0', 'Main')]
    const debugVars = [makeDebugVar('INSTANCE0._TMP_FUNC1_OUT', 'CUSTOM_TYPE', 500)]
    const projectData = { dataTypes: [] as PLCDataType[], pous: [pou] }

    const { treeMap } = buildDebugVariableTreeMap([pou], instances, debugVars, projectData, SYSTEM_LIBS)

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

    const { trees } = buildDebugVariableTreeMap([pou], instances, [], projectData, SYSTEM_LIBS)
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
