import type { DebugVariableEntry } from '../debug-parser'
import {
  appendToDebugPath,
  buildDebugPath,
  buildDebugPathPrefix,
  buildGlobalDebugPath,
  findDebugVariable,
  findDebugVariableForField,
  findDebugVariableWithFallback,
  findGlobalVariableIndex,
  findInstanceName,
  findVariableIndex,
  findVariableIndexWithFallback,
  getFieldIndexFromMapWithFallback,
  getIndexFromMapWithFallback,
  type PLCInstanceMapping,
} from '../debug-variable-finder'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDebugVar(name: string, type: string, index: number): DebugVariableEntry {
  return { name, type, index }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('findInstanceName', () => {
  const instances: PLCInstanceMapping[] = [
    { name: 'INSTANCE0', program: 'Main' },
    { name: 'INSTANCE1', program: 'Aux' },
  ]

  it('finds instance name by program name (case-insensitive)', () => {
    expect(findInstanceName('Main', instances)).toBe('INSTANCE0')
    expect(findInstanceName('main', instances)).toBe('INSTANCE0')
    expect(findInstanceName('MAIN', instances)).toBe('INSTANCE0')
  })

  it('returns null when program name is not found', () => {
    expect(findInstanceName('NonExistent', instances)).toBeNull()
  })
})

describe('buildDebugPath', () => {
  it('builds simple variable path', () => {
    expect(buildDebugPath('INSTANCE0', 'SPEED')).toBe('INSTANCE0.SPEED')
  })

  it('builds FB instance variable path', () => {
    expect(buildDebugPath('INSTANCE0', 'TIMER0.Q')).toBe('INSTANCE0.TIMER0.Q')
  })

  it('builds simple array element path', () => {
    const result = buildDebugPath('INSTANCE0', 'ARR', { isArrayElement: true, arrayIndex: 3 })
    expect(result).toBe('INSTANCE0.ARR[3]')
  })

  it('builds structure field path (no .value. shim in STruC++ paths)', () => {
    const result = buildDebugPath('INSTANCE0', 'MY_STRUCT.FIELD1')
    expect(result).toBe('INSTANCE0.MY_STRUCT.FIELD1')
  })

  it('builds structure field path with array index within structure', () => {
    const result = buildDebugPath('INSTANCE0', 'MY_STRUCT.[0]')
    expect(result).toBe('INSTANCE0.MY_STRUCT[0]')
  })

  it('handles array index in non-structure path (FB_ARRAY.[0].ET)', () => {
    const result = buildDebugPath('INSTANCE0', 'FB_ARRAY.[0].ET')
    expect(result).toBe('INSTANCE0.FB_ARRAY[0].ET')
  })

  it('uppercases the instance name', () => {
    expect(buildDebugPath('instance0', 'X')).toBe('INSTANCE0.X')
  })

  it('uses default arrayIndex of 0 when isArrayElement but no arrayIndex provided', () => {
    const result = buildDebugPath('INSTANCE0', 'ARR', { isArrayElement: true })
    expect(result).toBe('INSTANCE0.ARR[0]')
  })

  it('builds nested struct/FB field paths', () => {
    const result = buildDebugPath('INSTANCE0', 'OUTER.INNER.FIELD')
    expect(result).toBe('INSTANCE0.OUTER.INNER.FIELD')
  })
})

describe('buildGlobalDebugPath', () => {
  it('returns uppercased name', () => {
    expect(buildGlobalDebugPath('MY_GLOBAL')).toBe('MY_GLOBAL')
  })

  it('uppercases the variable path', () => {
    expect(buildGlobalDebugPath('my_global')).toBe('MY_GLOBAL')
  })
})

describe('findDebugVariable', () => {
  const debugVars = [makeDebugVar('INSTANCE0.SPEED', 'INT_ENUM', 0), makeDebugVar('INSTANCE0.TEMP', 'REAL_ENUM', 1)]

  it('finds variable by exact path (case-insensitive)', () => {
    const result = findDebugVariable(debugVars, 'INSTANCE0.SPEED')
    expect(result).toEqual(debugVars[0])
  })

  it('finds variable with different case', () => {
    const result = findDebugVariable(debugVars, 'instance0.speed')
    expect(result).toEqual(debugVars[0])
  })

  it('returns null when not found', () => {
    const result = findDebugVariable(debugVars, 'INSTANCE0.MISSING')
    expect(result).toBeNull()
  })
})

describe('findDebugVariableWithFallback', () => {
  it('resolves FB field paths', () => {
    const debugVars = [makeDebugVar('INSTANCE0.FB1.Q', 'BOOL_ENUM', 10)]
    const result = findDebugVariableWithFallback(debugVars, 'INSTANCE0', 'FB1.Q')

    expect(result.match).toEqual(debugVars[0])
    expect(result.usedStructureStyle).toBe(false)
  })

  it('resolves struct field paths with the same convention as FB fields', () => {
    const debugVars = [makeDebugVar('INSTANCE0.STRUCT.FIELD', 'INT_ENUM', 20)]
    const result = findDebugVariableWithFallback(debugVars, 'INSTANCE0', 'STRUCT.FIELD')

    expect(result.match).toEqual(debugVars[0])
    expect(result.usedStructureStyle).toBe(false)
  })

  it('returns null when the path is not found', () => {
    const result = findDebugVariableWithFallback([], 'INSTANCE0', 'MISSING.PATH')

    expect(result.match).toBeNull()
    expect(result.usedStructureStyle).toBe(false)
    expect(result.matchedPath).toBe('INSTANCE0.MISSING.PATH')
  })
})

describe('findVariableIndexWithFallback', () => {
  it('returns the index for FB field paths', () => {
    const debugVars = [makeDebugVar('INSTANCE0.FB.Q', 'BOOL_ENUM', 15)]
    const result = findVariableIndexWithFallback('INSTANCE0', 'FB.Q', debugVars)
    expect(result).toBe(15)
  })

  it('returns the index for struct field paths', () => {
    const debugVars = [makeDebugVar('INSTANCE0.S.F', 'INT_ENUM', 25)]
    const result = findVariableIndexWithFallback('INSTANCE0', 'S.F', debugVars)
    expect(result).toBe(25)
  })

  it('returns null when no path matches', () => {
    const result = findVariableIndexWithFallback('INSTANCE0', 'NOTHING', [])
    expect(result).toBeNull()
  })
})

describe('findDebugVariableForField', () => {
  it('finds FB field', () => {
    const debugVars = [makeDebugVar('INSTANCE0.MY_FB.Q', 'BOOL_ENUM', 30)]
    const result = findDebugVariableForField(debugVars, 'INSTANCE0.MY_FB', 'Q')

    expect(result.match).toEqual(debugVars[0])
    expect(result.matchedPath).toBe('INSTANCE0.MY_FB.Q')
    expect(result.usedStructureStyle).toBe(false)
  })

  it('finds struct field using the same path convention as FB', () => {
    const debugVars = [makeDebugVar('INSTANCE0.STRUCT.FIELD', 'INT_ENUM', 31)]
    const result = findDebugVariableForField(debugVars, 'INSTANCE0.STRUCT', 'FIELD')

    expect(result.match).toEqual(debugVars[0])
    expect(result.matchedPath).toBe('INSTANCE0.STRUCT.FIELD')
    expect(result.usedStructureStyle).toBe(false)
  })

  it('returns null when field is absent', () => {
    const result = findDebugVariableForField([], 'INSTANCE0.BASE', 'MISSING')

    expect(result.match).toBeNull()
    expect(result.matchedPath).toBe('INSTANCE0.BASE.MISSING')
    expect(result.usedStructureStyle).toBe(false)
  })

  it('uppercases field name in lookup', () => {
    const debugVars = [makeDebugVar('INSTANCE0.FB.FIELD', 'INT_ENUM', 32)]
    const result = findDebugVariableForField(debugVars, 'INSTANCE0.FB', 'field')

    expect(result.match).toEqual(debugVars[0])
  })
})

describe('getIndexFromMapWithFallback', () => {
  it('returns index by instance + variable path', () => {
    const indexMap = new Map([['INSTANCE0.FB.Q', 40]])
    const result = getIndexFromMapWithFallback(indexMap, 'INSTANCE0', 'FB.Q')
    expect(result).toBe(40)
  })

  it('returns index for struct field paths', () => {
    const indexMap = new Map([['INSTANCE0.STRUCT.FIELD', 41]])
    const result = getIndexFromMapWithFallback(indexMap, 'INSTANCE0', 'STRUCT.FIELD')
    expect(result).toBe(41)
  })

  it('returns undefined when path is not in the map', () => {
    const indexMap = new Map<string, number>()
    const result = getIndexFromMapWithFallback(indexMap, 'INSTANCE0', 'NOTHING')
    expect(result).toBeUndefined()
  })
})

describe('getFieldIndexFromMapWithFallback', () => {
  it('returns index by base path + field name', () => {
    const indexMap = new Map([['INSTANCE0.FB.FIELD', 50]])
    const result = getFieldIndexFromMapWithFallback(indexMap, 'INSTANCE0.FB', 'FIELD')
    expect(result).toBe(50)
  })

  it('returns index for struct field paths', () => {
    const indexMap = new Map([['INSTANCE0.S.F', 51]])
    const result = getFieldIndexFromMapWithFallback(indexMap, 'INSTANCE0.S', 'F')
    expect(result).toBe(51)
  })

  it('returns undefined when neither field path is in the map', () => {
    const indexMap = new Map<string, number>()
    const result = getFieldIndexFromMapWithFallback(indexMap, 'INSTANCE0.X', 'Y')
    expect(result).toBeUndefined()
  })

  it('uppercases field name in path lookup', () => {
    const indexMap = new Map([['INSTANCE0.FB.LOWERCASE', 52]])
    const result = getFieldIndexFromMapWithFallback(indexMap, 'INSTANCE0.FB', 'lowercase')
    expect(result).toBe(52)
  })
})

describe('findVariableIndex', () => {
  it('returns the index for a simple variable', () => {
    const debugVars = [makeDebugVar('INSTANCE0.SPEED', 'INT_ENUM', 60)]
    const result = findVariableIndex('INSTANCE0', 'SPEED', debugVars)
    expect(result).toBe(60)
  })

  it('returns null when variable is not found', () => {
    const result = findVariableIndex('INSTANCE0', 'MISSING', [])
    expect(result).toBeNull()
  })

  it('passes options through to buildDebugPath', () => {
    const debugVars = [makeDebugVar('INSTANCE0.ARR[2]', 'INT_ENUM', 61)]
    const result = findVariableIndex('INSTANCE0', 'ARR', debugVars, { isArrayElement: true, arrayIndex: 2 })
    expect(result).toBe(61)
  })

  it('handles struct field paths', () => {
    const debugVars = [makeDebugVar('INSTANCE0.S.F', 'INT_ENUM', 62)]
    const result = findVariableIndex('INSTANCE0', 'S.F', debugVars)
    expect(result).toBe(62)
  })
})

describe('findGlobalVariableIndex', () => {
  it('returns the index for a global variable', () => {
    const debugVars = [makeDebugVar('GLOBAL_FLAG', 'BOOL_ENUM', 70)]
    const result = findGlobalVariableIndex('GLOBAL_FLAG', debugVars)
    expect(result).toBe(70)
  })

  it('returns null when global variable is not found', () => {
    const result = findGlobalVariableIndex('MISSING', [])
    expect(result).toBeNull()
  })
})

describe('buildDebugPathPrefix', () => {
  it('returns INSTANCE_NAME prefix', () => {
    expect(buildDebugPathPrefix('INSTANCE0')).toBe('INSTANCE0')
  })

  it('uppercases the instance name', () => {
    expect(buildDebugPathPrefix('instance0')).toBe('INSTANCE0')
  })
})

describe('appendToDebugPath', () => {
  it('appends child name with dot separator and uppercases it', () => {
    expect(appendToDebugPath('INSTANCE0.FB', 'field')).toBe('INSTANCE0.FB.FIELD')
  })

  it('handles already uppercased child name', () => {
    expect(appendToDebugPath('INSTANCE0', 'VAR')).toBe('INSTANCE0.VAR')
  })
})
