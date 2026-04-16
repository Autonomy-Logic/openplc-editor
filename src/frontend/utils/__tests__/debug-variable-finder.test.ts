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
  parseDebugVariables,
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
    expect(buildDebugPath('INSTANCE0', 'SPEED')).toBe('RES0__INSTANCE0.SPEED')
  })

  it('builds FB instance variable path (no .value.)', () => {
    expect(buildDebugPath('INSTANCE0', 'TIMER0.Q')).toBe('RES0__INSTANCE0.TIMER0.Q')
  })

  it('builds simple array element path', () => {
    const result = buildDebugPath('INSTANCE0', 'ARR', { isArrayElement: true, arrayIndex: 3 })
    expect(result).toBe('RES0__INSTANCE0.ARR.value.table[3]')
  })

  it('builds structure field path with .value. insertion', () => {
    const result = buildDebugPath('INSTANCE0', 'MY_STRUCT.FIELD1', { isStructureField: true })
    expect(result).toBe('RES0__INSTANCE0.MY_STRUCT.value.FIELD1')
  })

  it('builds structure field path with array index within structure', () => {
    const result = buildDebugPath('INSTANCE0', 'MY_STRUCT.[0]', { isStructureField: true })
    expect(result).toBe('RES0__INSTANCE0.MY_STRUCT.value.table[0]')
  })

  it('handles array index in non-structure path (FB_ARRAY.[0].ET)', () => {
    const result = buildDebugPath('INSTANCE0', 'FB_ARRAY.[0].ET')
    expect(result).toBe('RES0__INSTANCE0.FB_ARRAY.value.table[0].ET')
  })

  it('uppercases the instance name', () => {
    expect(buildDebugPath('instance0', 'X')).toBe('RES0__INSTANCE0.X')
  })

  it('uses default arrayIndex of 0 when isArrayElement but no arrayIndex provided', () => {
    const result = buildDebugPath('INSTANCE0', 'ARR', { isArrayElement: true })
    expect(result).toBe('RES0__INSTANCE0.ARR.value.table[0]')
  })

  it('builds nested structure field paths', () => {
    const result = buildDebugPath('INSTANCE0', 'OUTER.INNER.FIELD', { isStructureField: true })
    expect(result).toBe('RES0__INSTANCE0.OUTER.value.INNER.value.FIELD')
  })
})

describe('buildGlobalDebugPath', () => {
  it('builds CONFIG0__ prefixed path', () => {
    expect(buildGlobalDebugPath('MY_GLOBAL')).toBe('CONFIG0__MY_GLOBAL')
  })

  it('uppercases the variable path', () => {
    expect(buildGlobalDebugPath('my_global')).toBe('CONFIG0__MY_GLOBAL')
  })
})

describe('findDebugVariable', () => {
  const debugVars = [
    makeDebugVar('RES0__INSTANCE0.SPEED', 'INT_ENUM', 0),
    makeDebugVar('RES0__INSTANCE0.TEMP', 'REAL_ENUM', 1),
  ]

  it('finds variable by exact path (case-insensitive)', () => {
    const result = findDebugVariable(debugVars, 'RES0__INSTANCE0.SPEED')
    expect(result).toEqual(debugVars[0])
  })

  it('finds variable with different case', () => {
    const result = findDebugVariable(debugVars, 'res0__instance0.speed')
    expect(result).toEqual(debugVars[0])
  })

  it('returns null when not found', () => {
    const result = findDebugVariable(debugVars, 'RES0__INSTANCE0.MISSING')
    expect(result).toBeNull()
  })
})

describe('findDebugVariableWithFallback', () => {
  it('finds variable using FB-style path first', () => {
    const debugVars = [makeDebugVar('RES0__INSTANCE0.FB1.Q', 'BOOL_ENUM', 10)]
    const result = findDebugVariableWithFallback(debugVars, 'INSTANCE0', 'FB1.Q')

    expect(result.match).toEqual(debugVars[0])
    expect(result.usedStructureStyle).toBe(false)
  })

  it('falls back to structure-style path when FB-style fails', () => {
    const debugVars = [makeDebugVar('RES0__INSTANCE0.STRUCT.value.FIELD', 'INT_ENUM', 20)]
    const result = findDebugVariableWithFallback(debugVars, 'INSTANCE0', 'STRUCT.FIELD')

    expect(result.match).toEqual(debugVars[0])
    expect(result.usedStructureStyle).toBe(true)
  })

  it('returns null match when neither path style works', () => {
    const result = findDebugVariableWithFallback([], 'INSTANCE0', 'MISSING.PATH')

    expect(result.match).toBeNull()
    expect(result.usedStructureStyle).toBe(false)
    expect(result.matchedPath).toBe('RES0__INSTANCE0.MISSING.PATH')
  })
})

describe('findVariableIndexWithFallback', () => {
  it('returns the index when FB-style path matches', () => {
    const debugVars = [makeDebugVar('RES0__INSTANCE0.FB.Q', 'BOOL_ENUM', 15)]
    const result = findVariableIndexWithFallback('INSTANCE0', 'FB.Q', debugVars)
    expect(result).toBe(15)
  })

  it('returns the index when structure-style path matches', () => {
    const debugVars = [makeDebugVar('RES0__INSTANCE0.S.value.F', 'INT_ENUM', 25)]
    const result = findVariableIndexWithFallback('INSTANCE0', 'S.F', debugVars)
    expect(result).toBe(25)
  })

  it('returns null when no path matches', () => {
    const result = findVariableIndexWithFallback('INSTANCE0', 'NOTHING', [])
    expect(result).toBeNull()
  })
})

describe('findDebugVariableForField', () => {
  it('finds field using FB-style path (no .value.)', () => {
    const debugVars = [makeDebugVar('RES0__INSTANCE0.MY_FB.Q', 'BOOL_ENUM', 30)]
    const result = findDebugVariableForField(debugVars, 'RES0__INSTANCE0.MY_FB', 'Q')

    expect(result.match).toEqual(debugVars[0])
    expect(result.matchedPath).toBe('RES0__INSTANCE0.MY_FB.Q')
    expect(result.usedStructureStyle).toBe(false)
  })

  it('finds field using struct-style path (with .value.)', () => {
    const debugVars = [makeDebugVar('RES0__INSTANCE0.STRUCT.value.FIELD', 'INT_ENUM', 31)]
    const result = findDebugVariableForField(debugVars, 'RES0__INSTANCE0.STRUCT', 'FIELD')

    expect(result.match).toEqual(debugVars[0])
    expect(result.matchedPath).toBe('RES0__INSTANCE0.STRUCT.value.FIELD')
    expect(result.usedStructureStyle).toBe(true)
  })

  it('returns null match when neither path works', () => {
    const result = findDebugVariableForField([], 'RES0__INSTANCE0.BASE', 'MISSING')

    expect(result.match).toBeNull()
    expect(result.matchedPath).toBe('RES0__INSTANCE0.BASE.MISSING')
    expect(result.usedStructureStyle).toBe(false)
  })

  it('uppercases field name in lookup', () => {
    const debugVars = [makeDebugVar('RES0__INSTANCE0.FB.FIELD', 'INT_ENUM', 32)]
    const result = findDebugVariableForField(debugVars, 'RES0__INSTANCE0.FB', 'field')

    expect(result.match).toEqual(debugVars[0])
  })
})

describe('getIndexFromMapWithFallback', () => {
  it('returns index from FB-style path', () => {
    const indexMap = new Map([['RES0__INSTANCE0.FB.Q', 40]])
    const result = getIndexFromMapWithFallback(indexMap, 'INSTANCE0', 'FB.Q')
    expect(result).toBe(40)
  })

  it('returns index from struct-style path when FB-style fails', () => {
    const indexMap = new Map([['RES0__INSTANCE0.STRUCT.value.FIELD', 41]])
    const result = getIndexFromMapWithFallback(indexMap, 'INSTANCE0', 'STRUCT.FIELD')
    expect(result).toBe(41)
  })

  it('returns undefined when neither path is in the map', () => {
    const indexMap = new Map<string, number>()
    const result = getIndexFromMapWithFallback(indexMap, 'INSTANCE0', 'NOTHING')
    expect(result).toBeUndefined()
  })
})

describe('getFieldIndexFromMapWithFallback', () => {
  it('returns index from FB-style field path', () => {
    const indexMap = new Map([['RES0__INSTANCE0.FB.FIELD', 50]])
    const result = getFieldIndexFromMapWithFallback(indexMap, 'RES0__INSTANCE0.FB', 'FIELD')
    expect(result).toBe(50)
  })

  it('returns index from struct-style field path when FB-style fails', () => {
    const indexMap = new Map([['RES0__INSTANCE0.S.value.F', 51]])
    const result = getFieldIndexFromMapWithFallback(indexMap, 'RES0__INSTANCE0.S', 'F')
    expect(result).toBe(51)
  })

  it('returns undefined when neither field path is in the map', () => {
    const indexMap = new Map<string, number>()
    const result = getFieldIndexFromMapWithFallback(indexMap, 'RES0__INSTANCE0.X', 'Y')
    expect(result).toBeUndefined()
  })

  it('uppercases field name in path lookup', () => {
    const indexMap = new Map([['RES0__INSTANCE0.FB.LOWERCASE', 52]])
    const result = getFieldIndexFromMapWithFallback(indexMap, 'RES0__INSTANCE0.FB', 'lowercase')
    expect(result).toBe(52)
  })
})

describe('findVariableIndex', () => {
  it('returns the index for a simple variable', () => {
    const debugVars = [makeDebugVar('RES0__INSTANCE0.SPEED', 'INT_ENUM', 60)]
    const result = findVariableIndex('INSTANCE0', 'SPEED', debugVars)
    expect(result).toBe(60)
  })

  it('returns null when variable is not found', () => {
    const result = findVariableIndex('INSTANCE0', 'MISSING', [])
    expect(result).toBeNull()
  })

  it('passes options through to buildDebugPath', () => {
    const debugVars = [makeDebugVar('RES0__INSTANCE0.ARR.value.table[2]', 'INT_ENUM', 61)]
    const result = findVariableIndex('INSTANCE0', 'ARR', debugVars, { isArrayElement: true, arrayIndex: 2 })
    expect(result).toBe(61)
  })

  it('handles structure field option', () => {
    const debugVars = [makeDebugVar('RES0__INSTANCE0.S.value.F', 'INT_ENUM', 62)]
    const result = findVariableIndex('INSTANCE0', 'S.F', debugVars, { isStructureField: true })
    expect(result).toBe(62)
  })
})

describe('findGlobalVariableIndex', () => {
  it('returns the index for a global variable', () => {
    const debugVars = [makeDebugVar('CONFIG0__GLOBAL_FLAG', 'BOOL_ENUM', 70)]
    const result = findGlobalVariableIndex('GLOBAL_FLAG', debugVars)
    expect(result).toBe(70)
  })

  it('returns null when global variable is not found', () => {
    const result = findGlobalVariableIndex('MISSING', [])
    expect(result).toBeNull()
  })
})

describe('buildDebugPathPrefix', () => {
  it('returns RES0__INSTANCE_NAME prefix', () => {
    expect(buildDebugPathPrefix('INSTANCE0')).toBe('RES0__INSTANCE0')
  })

  it('uppercases the instance name', () => {
    expect(buildDebugPathPrefix('instance0')).toBe('RES0__INSTANCE0')
  })
})

describe('appendToDebugPath', () => {
  it('appends child name with dot separator and uppercases it', () => {
    expect(appendToDebugPath('RES0__INSTANCE0.FB', 'field')).toBe('RES0__INSTANCE0.FB.FIELD')
  })

  it('handles already uppercased child name', () => {
    expect(appendToDebugPath('RES0__INSTANCE0', 'VAR')).toBe('RES0__INSTANCE0.VAR')
  })
})

describe('parseDebugVariables (re-exported)', () => {
  it('is re-exported from debug-variable-finder and works', () => {
    const content = `debug_vars[] = { {&(VAR), INT_ENUM} };`
    const result = parseDebugVariables(content)
    expect(result).toEqual([{ name: 'VAR', type: 'INT_ENUM', index: 0 }])
  })
})
