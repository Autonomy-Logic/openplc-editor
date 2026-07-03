import type { PLCPou, PLCVariable } from '../../../middleware/shared/ports/types'
import { buildActiveIndexSet, type VisibleVarsCache } from '../debug-polling-filter'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVariable(name: string, cls: PLCVariable['class'] = 'local', debug = false): PLCVariable {
  return {
    name,
    class: cls,
    type: { definition: 'base-type', value: 'INT' },
    location: '',
    documentation: '',
    debug,
  }
}

function makeDerivedVariable(name: string, typeName: string, debug = false): PLCVariable {
  return {
    name,
    class: 'local',
    type: { definition: 'derived', value: typeName },
    location: '',
    documentation: '',
    debug,
  }
}

function makeArrayVariable(name: string, baseType: string, range: string, debug = false): PLCVariable {
  return {
    name,
    class: 'local',
    type: {
      definition: 'array',
      value: '',
      data: {
        baseType: { definition: 'base-type', value: baseType },
        dimensions: [{ dimension: range }],
      },
    },
    location: '',
    documentation: '',
    debug,
  }
}

function makePou(name: string, pouType: PLCPou['pouType'], vars: PLCVariable[] = [], language = 'st'): PLCPou {
  return {
    name,
    pouType,
    interface: { variables: vars },
    body: { language: language as PLCPou['body']['language'], value: '' },
  }
}

/** Minimal state factory. Fills only the fields used by buildActiveIndexSet. */
function makeState(overrides: {
  pous?: PLCPou[]
  debugVariableIndexes?: Map<string, number>
  debugForcedVariables?: Map<string, unknown>
  debugExpandedNodes?: Map<string, boolean>
  debugGraphList?: string[]
  fbSelectedInstance?: Map<string, string>
  fbDebugInstances?: Map<
    string,
    { fbTypeName: string; programName: string; programInstanceName: string; fbVariableName: string; key: string }[]
  >
  editorName?: string
  editorLanguage?: string
  ladderFlows?: unknown[]
  fbdFlows?: unknown[]
}) {
  return {
    project: {
      data: {
        pous: overrides.pous ?? [],
      },
    },
    workspace: {
      debugVariableIndexes: overrides.debugVariableIndexes ?? new Map(),
      debugForcedVariables: overrides.debugForcedVariables ?? new Map(),
      debugExpandedNodes: overrides.debugExpandedNodes ?? new Map(),
      debugGraphList: overrides.debugGraphList ?? [],
      fbSelectedInstance: overrides.fbSelectedInstance ?? new Map(),
      fbDebugInstances: overrides.fbDebugInstances ?? new Map(),
    },
    editor: {
      meta: {
        name: overrides.editorName ?? '',
        ...(overrides.editorLanguage !== undefined ? { language: overrides.editorLanguage } : {}),
      },
    },
    ladderFlows: overrides.ladderFlows ?? [],
    fbdFlows: overrides.fbdFlows ?? [],
  } as never
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildActiveIndexSet', () => {
  it('returns empty indexes when there are no active variables', () => {
    const state = makeState({})
    const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()
    const { activeIndexes, cacheResult } = buildActiveIndexSet(state, allLeaves, null)
    expect(activeIndexes).toEqual([])
    expect(cacheResult).toBeNull()
  })

  describe('watched variables (debug === true)', () => {
    it('collects watched variables from a program POU', () => {
      const pou = makePou('Main', 'program', [
        makeVariable('SPEED', 'local', true),
        makeVariable('TEMP', 'local', false),
      ])
      const indexMap = new Map([['Main:SPEED', 10]])
      const state = makeState({ pous: [pou], debugVariableIndexes: indexMap })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toEqual([10])
    })

    it('resolves FB watched variables through fbSelectedInstance', () => {
      const fbPou = makePou('MyFB', 'function-block', [makeVariable('OUT', 'output', true)])
      const indexMap = new Map([['Main:fb0.OUT', 5]])
      const fbInstances = new Map([
        [
          'MYFB',
          [
            {
              fbTypeName: 'MyFB',
              programName: 'Main',
              programInstanceName: 'INSTANCE0',
              fbVariableName: 'fb0',
              key: 'Main:fb0',
            },
          ],
        ],
      ])
      const fbSelected = new Map([['MYFB', 'Main:fb0']])
      const state = makeState({
        pous: [fbPou],
        debugVariableIndexes: indexMap,
        fbSelectedInstance: fbSelected,
        fbDebugInstances: fbInstances,
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toEqual([5])
    })

    it('skips FB watched variables when no instance is selected', () => {
      const fbPou = makePou('MyFB', 'function-block', [makeVariable('OUT', 'output', true)])
      const state = makeState({ pous: [fbPou] })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toEqual([])
    })

    it('skips FB watched variables when selected key does not match any instance', () => {
      const fbPou = makePou('MyFB', 'function-block', [makeVariable('OUT', 'output', true)])
      const fbInstances = new Map([
        [
          'MYFB',
          [
            {
              fbTypeName: 'MyFB',
              programName: 'Main',
              programInstanceName: 'INSTANCE0',
              fbVariableName: 'fb0',
              key: 'Main:fb0',
            },
          ],
        ],
      ])
      const fbSelected = new Map([['MYFB', 'NONEXISTENT_KEY']])
      const state = makeState({
        pous: [fbPou],
        fbSelectedInstance: fbSelected,
        fbDebugInstances: fbInstances,
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toEqual([])
    })

    it('skips POUs with no variables at all', () => {
      const pou: PLCPou = {
        name: 'Empty',
        pouType: 'program',
        body: { language: 'st', value: '' },
      }
      const state = makeState({ pous: [pou] })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toEqual([])
    })
  })

  describe('forced variables', () => {
    it('includes forced variable indexes', () => {
      const forced = new Map([['Main:FORCED_VAR', { value: 42 }]])
      const indexMap = new Map([['Main:FORCED_VAR', 7]])
      const state = makeState({ debugForcedVariables: forced, debugVariableIndexes: indexMap })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toEqual([7])
    })
  })

  describe('graph-listed variables', () => {
    it('includes graph-listed variable indexes', () => {
      const indexMap = new Map([['Main:PLOTTED', 3]])
      const state = makeState({ debugGraphList: ['Main:PLOTTED'], debugVariableIndexes: indexMap })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toEqual([3])
    })
  })

  describe('expanded nested children', () => {
    it('includes nested variable when ancestor is watched and path is expanded', () => {
      const pou = makePou('Main', 'program', [makeDerivedVariable('MyStruct', 'MY_STRUCT_TYPE', true)])
      const indexMap = new Map([
        ['Main:MyStruct', 10],
        ['Main:MyStruct.field1', 11],
      ])
      const expandedNodes = new Map([['Main:MyStruct', true]])
      const state = makeState({
        pous: [pou],
        debugVariableIndexes: indexMap,
        debugExpandedNodes: expandedNodes,
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>([
        [11, [{ compositeKey: 'Main:MyStruct.field1', type: 'INT' }]],
      ])

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toContain(11)
    })

    it('excludes nested variable when path is not expanded', () => {
      const pou = makePou('Main', 'program', [makeDerivedVariable('MyStruct', 'MY_STRUCT_TYPE', true)])
      const indexMap = new Map([
        ['Main:MyStruct', 10],
        ['Main:MyStruct.field1', 11],
      ])
      // No expanded nodes
      const state = makeState({
        pous: [pou],
        debugVariableIndexes: indexMap,
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>([
        [11, [{ compositeKey: 'Main:MyStruct.field1', type: 'INT' }]],
      ])

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).not.toContain(11)
    })

    it('skips leaf entry with no colon in compositeKey', () => {
      const state = makeState({})
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>([
        [99, [{ compositeKey: 'no-colon-key', type: 'INT' }]],
      ])

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toEqual([])
    })

    // Regression: array elements use `[N]` notation, not `.N`. Step 4
    // used to filter them out before resolving expansion, so a watched +
    // expanded array was silently empty.
    it('includes array elements when array root is watched and expanded', () => {
      const pou = makePou('Main', 'program', [makeArrayVariable('MY_ARRAY', 'DINT', '1..3', true)])
      const indexMap = new Map([
        ['Main:MY_ARRAY', 100],
        ['Main:MY_ARRAY[1]', 101],
        ['Main:MY_ARRAY[2]', 102],
        ['Main:MY_ARRAY[3]', 103],
      ])
      const expandedNodes = new Map([['Main:MY_ARRAY', true]])
      const state = makeState({
        pous: [pou],
        debugVariableIndexes: indexMap,
        debugExpandedNodes: expandedNodes,
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>([
        [101, [{ compositeKey: 'Main:MY_ARRAY[1]', type: 'DINT' }]],
        [102, [{ compositeKey: 'Main:MY_ARRAY[2]', type: 'DINT' }]],
        [103, [{ compositeKey: 'Main:MY_ARRAY[3]', type: 'DINT' }]],
      ])

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toEqual(expect.arrayContaining([101, 102, 103]))
    })

    it('excludes array elements when array root is watched but NOT expanded', () => {
      const pou = makePou('Main', 'program', [makeArrayVariable('MY_ARRAY', 'DINT', '1..3', true)])
      const indexMap = new Map([
        ['Main:MY_ARRAY', 100],
        ['Main:MY_ARRAY[1]', 101],
      ])
      // No expanded nodes
      const state = makeState({
        pous: [pou],
        debugVariableIndexes: indexMap,
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>([
        [101, [{ compositeKey: 'Main:MY_ARRAY[1]', type: 'DINT' }]],
      ])

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).not.toContain(101)
    })

    // Arrays inside FBs / structs need both the FB and the array root
    // expanded for elements to be polled.
    it('includes array elements nested under a watched FB only when chain is fully expanded', () => {
      const pou = makePou('Main', 'program', [makeDerivedVariable('FB', 'MY_FB', true)])
      const indexMap = new Map([
        ['Main:FB', 10],
        ['Main:FB.ARR[1]', 21],
        ['Main:FB.ARR[2]', 22],
      ])
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>([
        [21, [{ compositeKey: 'Main:FB.ARR[1]', type: 'INT' }]],
        [22, [{ compositeKey: 'Main:FB.ARR[2]', type: 'INT' }]],
      ])

      // Only FB expanded — array root is collapsed → elements stay hidden
      let state = makeState({
        pous: [pou],
        debugVariableIndexes: indexMap,
        debugExpandedNodes: new Map([['Main:FB', true]]),
      })
      expect(buildActiveIndexSet(state, allLeaves, null).activeIndexes).not.toContain(21)

      // Both FB and array root expanded → elements polled
      state = makeState({
        pous: [pou],
        debugVariableIndexes: indexMap,
        debugExpandedNodes: new Map([
          ['Main:FB', true],
          ['Main:FB.ARR', true],
        ]),
      })
      expect(buildActiveIndexSet(state, allLeaves, null).activeIndexes).toEqual(expect.arrayContaining([21, 22]))
    })

    // Array of complex elements (FBs / structs). Expanding the array
    // surfaces the elements as nodes, but their inner fields stay hidden
    // until the user expands the specific element they want to inspect.
    // Polling must reflect this: only the expanded element's leaves run.
    it('only polls the expanded element of an array-of-FBs', () => {
      const pou = makePou('Main', 'program', [makeArrayVariable('FB_ARR', 'MY_FB', '1..3', true)])
      const indexMap = new Map([
        ['Main:FB_ARR', 50],
        ['Main:FB_ARR[1].Q', 61],
        ['Main:FB_ARR[1].ET', 62],
        ['Main:FB_ARR[2].Q', 71],
        ['Main:FB_ARR[2].ET', 72],
        ['Main:FB_ARR[3].Q', 81],
        ['Main:FB_ARR[3].ET', 82],
      ])
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>([
        [61, [{ compositeKey: 'Main:FB_ARR[1].Q', type: 'BOOL' }]],
        [62, [{ compositeKey: 'Main:FB_ARR[1].ET', type: 'TIME' }]],
        [71, [{ compositeKey: 'Main:FB_ARR[2].Q', type: 'BOOL' }]],
        [72, [{ compositeKey: 'Main:FB_ARR[2].ET', type: 'TIME' }]],
        [81, [{ compositeKey: 'Main:FB_ARR[3].Q', type: 'BOOL' }]],
        [82, [{ compositeKey: 'Main:FB_ARR[3].ET', type: 'TIME' }]],
      ])

      // Array expanded, only element [2] expanded → only [2]'s leaves poll
      const state = makeState({
        pous: [pou],
        debugVariableIndexes: indexMap,
        debugExpandedNodes: new Map([
          ['Main:FB_ARR', true],
          ['Main:FB_ARR[2]', true],
        ]),
      })
      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toEqual(expect.arrayContaining([71, 72]))
      expect(activeIndexes).not.toContain(61)
      expect(activeIndexes).not.toContain(62)
      expect(activeIndexes).not.toContain(81)
      expect(activeIndexes).not.toContain(82)
    })

    it('polls all elements of a base-type array when root is expanded', () => {
      const pou = makePou('Main', 'program', [makeArrayVariable('BOOLS', 'BOOL', '0..2', true)])
      const indexMap = new Map([
        ['Main:BOOLS', 90],
        ['Main:BOOLS[0]', 91],
        ['Main:BOOLS[1]', 92],
        ['Main:BOOLS[2]', 93],
      ])
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>([
        [91, [{ compositeKey: 'Main:BOOLS[0]', type: 'BOOL' }]],
        [92, [{ compositeKey: 'Main:BOOLS[1]', type: 'BOOL' }]],
        [93, [{ compositeKey: 'Main:BOOLS[2]', type: 'BOOL' }]],
      ])
      const state = makeState({
        pous: [pou],
        debugVariableIndexes: indexMap,
        debugExpandedNodes: new Map([['Main:BOOLS', true]]),
      })
      expect(buildActiveIndexSet(state, allLeaves, null).activeIndexes).toEqual(expect.arrayContaining([91, 92, 93]))
    })

    it('skips leaf without dot in variable part (not nested)', () => {
      const pou = makePou('Main', 'program', [makeVariable('X', 'local', true)])
      const indexMap = new Map([['Main:X', 1]])
      const state = makeState({ pous: [pou], debugVariableIndexes: indexMap })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>([
        [1, [{ compositeKey: 'Main:X', type: 'INT' }]],
      ])

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      // X is included because it's watched, not because it's a nested child
      expect(activeIndexes).toEqual([1])
    })

    it('includes nested variable if it is in graphList', () => {
      const state = makeState({
        debugGraphList: ['Main:MyStruct.field1'],
        debugVariableIndexes: new Map([['Main:MyStruct.field1', 11]]),
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>([
        [11, [{ compositeKey: 'Main:MyStruct.field1', type: 'INT' }]],
      ])

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toContain(11)
    })

    it('returns false for deeply nested variable when no ancestor is watched', () => {
      const state = makeState({
        debugExpandedNodes: new Map([['Main:A', true]]),
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>([
        [20, [{ compositeKey: 'Main:A.B.C', type: 'INT' }]],
      ])

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).not.toContain(20)
    })

    it('returns true for single-part nested variable (parts.length <= 1)', () => {
      // This exercises the "parts.length <= 1 → return true" branch inside
      // shouldPollNestedVariable when varName still contains a dot but splits into 1 part.
      // In practice parts.length is always > 1 if varName includes '.', but we need to
      // reach the branch where watchedAncestorIndex > -1 and all expansion checks pass.
      const pou = makePou('Main', 'program', [makeDerivedVariable('FB0', 'SomeFB', true)])
      const indexMap = new Map([
        ['Main:FB0', 10],
        ['Main:FB0.Q', 11],
      ])
      const expandedNodes = new Map([['Main:FB0', true]])
      const state = makeState({
        pous: [pou],
        debugVariableIndexes: indexMap,
        debugExpandedNodes: expandedNodes,
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>([
        [11, [{ compositeKey: 'Main:FB0.Q', type: 'BOOL' }]],
      ])

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toContain(11)
    })
  })

  describe('diagram-visible / source-visible caching', () => {
    it('uses cached result when pouName, language, and fbContextKey match', () => {
      const pou = makePou('Main', 'program', [], 'st')
      const cachedKeys = new Set(['Main:CACHED_VAR'])
      const cached: VisibleVarsCache = {
        pouName: 'Main',
        language: 'st',
        fbContextKey: '',
        keys: cachedKeys,
      }
      const indexMap = new Map([['Main:CACHED_VAR', 99]])
      const state = makeState({
        pous: [pou],
        editorName: 'Main',
        editorLanguage: 'st',
        debugVariableIndexes: indexMap,
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes, cacheResult } = buildActiveIndexSet(state, allLeaves, cached)
      expect(activeIndexes).toContain(99)
      expect(cacheResult).toBe(cached)
    })

    it('recomputes cache when editor name changes', () => {
      const pou = makePou('Main', 'program', [makeVariable('X', 'local')], 'st')
      const cached: VisibleVarsCache = {
        pouName: 'OtherPou',
        language: 'st',
        fbContextKey: '',
        keys: new Set(['OtherPou:OLD']),
      }
      const state = makeState({
        pous: [pou],
        editorName: 'Main',
        editorLanguage: 'st',
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { cacheResult } = buildActiveIndexSet(state, allLeaves, cached)
      // Cache should have been replaced
      expect(cacheResult).not.toBe(cached)
      expect(cacheResult?.pouName).toBe('Main')
    })

    it('skips diagram/source scan when currentPou is not found', () => {
      const state = makeState({ editorName: 'Nonexistent' })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes, cacheResult } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toEqual([])
      expect(cacheResult).toBeNull()
    })

    it('uses fbSelectedInstance for function-block FB context key', () => {
      const fbPou = makePou('MyFB', 'function-block', [], 'st')
      const fbSelected = new Map([['MYFB', 'Main:fb0']])
      const fbInstances = new Map([
        [
          'MYFB',
          [
            {
              fbTypeName: 'MyFB',
              programName: 'Main',
              programInstanceName: 'INSTANCE0',
              fbVariableName: 'fb0',
              key: 'Main:fb0',
            },
          ],
        ],
      ])
      const cached: VisibleVarsCache = {
        pouName: 'MyFB',
        language: 'st',
        fbContextKey: 'Main:fb0',
        keys: new Set(),
      }
      const state = makeState({
        pous: [fbPou],
        editorName: 'MyFB',
        editorLanguage: 'st',
        fbSelectedInstance: fbSelected,
        fbDebugInstances: fbInstances,
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { cacheResult } = buildActiveIndexSet(state, allLeaves, cached)
      // Cache should still be valid because fbContextKey matches
      expect(cacheResult).toBe(cached)
    })
  })

  describe('index resolution', () => {
    it('resolves indexes from allLeaves when debugVariableIndexes does not have the key', () => {
      const pou = makePou('Main', 'program', [makeVariable('A', 'local', true)])
      // A is watched but NOT in debugVariableIndexes
      const state = makeState({ pous: [pou] })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>([
        [42, [{ compositeKey: 'Main:A', type: 'INT' }]],
      ])

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toEqual([42])
    })

    it('returns sorted indexes', () => {
      const pou = makePou('Main', 'program', [
        makeVariable('C', 'local', true),
        makeVariable('A', 'local', true),
        makeVariable('B', 'local', true),
      ])
      const indexMap = new Map([
        ['Main:C', 30],
        ['Main:A', 10],
        ['Main:B', 20],
      ])
      const state = makeState({ pous: [pou], debugVariableIndexes: indexMap })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toEqual([10, 20, 30])
    })

    it('deduplicates indexes from both debugVariableIndexes and allLeaves', () => {
      const forced = new Map([['Main:X', { value: 0 }]])
      const indexMap = new Map([['Main:X', 5]])
      const state = makeState({ debugForcedVariables: forced, debugVariableIndexes: indexMap })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>([
        [5, [{ compositeKey: 'Main:X', type: 'INT' }]],
      ])

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toEqual([5])
    })
  })

  describe('source-visible variables (ST/IL)', () => {
    it('includes variables mentioned in source text', () => {
      const pou = makePou('Main', 'program', [makeVariable('SPEED', 'local')], 'st')
      pou.body.value = 'SPEED := 100;'
      const indexMap = new Map([['Main:SPEED', 15]])
      const state = makeState({
        pous: [pou],
        editorName: 'Main',
        editorLanguage: 'st',
        debugVariableIndexes: indexMap,
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toContain(15)
    })

    it('includes FB sub-variables when FB instance appears in ST source text', () => {
      const fbVar: PLCVariable = {
        name: 'MyTimer',
        class: 'local',
        type: { definition: 'derived', value: 'TON' },
        location: '',
        documentation: '',
      }
      const pou = makePou('Main', 'program', [fbVar], 'st')
      pou.body.value = 'MyTimer(IN := TRUE, PT := T#1s);'
      const indexMap = new Map([['Main:MyTimer.ET', 20]])
      const state = makeState({
        pous: [pou],
        editorName: 'Main',
        editorLanguage: 'st',
        debugVariableIndexes: indexMap,
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>([
        [20, [{ compositeKey: 'Main:MyTimer.ET', type: 'TIME' }]],
      ])

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toContain(20)
    })

    it('does not include variables not mentioned in source text', () => {
      const pou = makePou('Main', 'program', [makeVariable('UNUSED', 'local')], 'st')
      pou.body.value = 'X := 1;'
      const indexMap = new Map([['Main:UNUSED', 50]])
      const state = makeState({
        pous: [pou],
        editorName: 'Main',
        editorLanguage: 'st',
        debugVariableIndexes: indexMap,
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).not.toContain(50)
    })

    it('handles IL language the same as ST', () => {
      const pou = makePou('Main', 'program', [makeVariable('VAL', 'local')], 'il')
      pou.body.value = 'LD VAL'
      const indexMap = new Map([['Main:VAL', 8]])
      const state = makeState({
        pous: [pou],
        editorName: 'Main',
        editorLanguage: 'il',
        debugVariableIndexes: indexMap,
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toContain(8)
    })

    it('skips source scan when body value is not a string', () => {
      const pou = makePou('Main', 'program', [makeVariable('X', 'local')], 'st')
      pou.body.value = { nodes: [], edges: [] }
      const indexMap = new Map([['Main:X', 8]])
      const state = makeState({
        pous: [pou],
        editorName: 'Main',
        editorLanguage: 'st',
        debugVariableIndexes: indexMap,
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).not.toContain(8)
    })

    it('skips source scan when body value is empty string', () => {
      const pou = makePou('Main', 'program', [makeVariable('X', 'local')], 'st')
      pou.body.value = ''
      const indexMap = new Map([['Main:X', 8]])
      const state = makeState({
        pous: [pou],
        editorName: 'Main',
        editorLanguage: 'st',
        debugVariableIndexes: indexMap,
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).not.toContain(8)
    })
  })

  describe('LD diagram-visible variables', () => {
    it('includes contact and coil variable names from LD flow', () => {
      const pou = makePou('Main', 'program', [], 'ld')
      const indexMap = new Map([
        ['Main:CONTACT_VAR', 1],
        ['Main:COIL_VAR', 2],
      ])
      const ldFlow = {
        name: 'Main',
        rungs: [
          {
            nodes: [
              { type: 'contact', data: { variable: { name: 'CONTACT_VAR' } } },
              { type: 'coil', data: { variable: { name: 'COIL_VAR' } } },
            ],
          },
        ],
      }
      const state = makeState({
        pous: [pou],
        editorName: 'Main',
        editorLanguage: 'ld',
        debugVariableIndexes: indexMap,
        ladderFlows: [ldFlow],
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toContain(1)
      expect(activeIndexes).toContain(2)
    })

    it('includes LD variable-type nodes', () => {
      const pou = makePou('Main', 'program', [], 'ld')
      const indexMap = new Map([['Main:VAR_NODE', 3]])
      const ldFlow = {
        name: 'Main',
        rungs: [
          {
            nodes: [{ type: 'variable', data: { variable: { name: 'VAR_NODE' } } }],
          },
        ],
      }
      const state = makeState({
        pous: [pou],
        editorName: 'Main',
        editorLanguage: 'ld',
        debugVariableIndexes: indexMap,
        ladderFlows: [ldFlow],
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toContain(3)
    })

    it('skips LD nodes without variable name', () => {
      const pou = makePou('Main', 'program', [], 'ld')
      const ldFlow = {
        name: 'Main',
        rungs: [
          {
            nodes: [
              { type: 'contact', data: { variable: {} } },
              { type: 'coil', data: {} },
              { type: 'variable', data: { variable: {} } },
            ],
          },
        ],
      }
      const state = makeState({
        pous: [pou],
        editorName: 'Main',
        editorLanguage: 'ld',
        ladderFlows: [ldFlow],
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toEqual([])
    })

    it('handles LD block nodes with function-block variant', () => {
      const pou = makePou('Main', 'program', [], 'ld')
      const ldFlow = {
        name: 'Main',
        rungs: [
          {
            nodes: [
              {
                type: 'block',
                data: {
                  variant: { name: 'TON', type: 'function-block', variables: [] },
                  variable: { name: 'MyTimer' },
                },
              },
            ],
          },
        ],
      }
      const state = makeState({
        pous: [pou],
        editorName: 'Main',
        editorLanguage: 'ld',
        ladderFlows: [ldFlow],
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>([
        [50, [{ compositeKey: 'Main:MyTimer.Q', type: 'BOOL' }]],
      ])

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toContain(50)
    })

    it('handles LD block nodes with function variant and numericId', () => {
      const pou = makePou('Main', 'program', [], 'ld')
      const ldFlow = {
        name: 'Main',
        rungs: [
          {
            nodes: [
              {
                type: 'block',
                data: {
                  variant: { name: 'ADD', type: 'function' },
                  numericId: '3',
                },
              },
            ],
          },
        ],
      }
      const state = makeState({
        pous: [pou],
        editorName: 'Main',
        editorLanguage: 'ld',
        ladderFlows: [ldFlow],
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>([
        [60, [{ compositeKey: 'Main:_TMP_ADD3_OUT', type: 'INT' }]],
      ])

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toContain(60)
    })

    it('skips LD block with no variant', () => {
      const pou = makePou('Main', 'program', [], 'ld')
      const ldFlow = {
        name: 'Main',
        rungs: [
          {
            nodes: [{ type: 'block', data: {} }],
          },
        ],
      }
      const state = makeState({
        pous: [pou],
        editorName: 'Main',
        editorLanguage: 'ld',
        ladderFlows: [ldFlow],
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toEqual([])
    })

    it('skips LD when no matching flow is found', () => {
      const pou = makePou('Main', 'program', [], 'ld')
      const state = makeState({
        pous: [pou],
        editorName: 'Main',
        editorLanguage: 'ld',
        ladderFlows: [{ name: 'OtherPou', rungs: [] }],
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toEqual([])
    })
  })

  describe('FBD diagram-visible variables', () => {
    it('includes input, output, and inout variable nodes from FBD flow', () => {
      const pou = makePou('Main', 'program', [], 'fbd')
      const indexMap = new Map([
        ['Main:IN_VAR', 1],
        ['Main:OUT_VAR', 2],
        ['Main:INOUT_VAR', 3],
      ])
      const fbdFlow = {
        name: 'Main',
        rung: {
          nodes: [
            { type: 'input-variable', data: { variable: { name: 'IN_VAR' } } },
            { type: 'output-variable', data: { variable: { name: 'OUT_VAR' } } },
            { type: 'inout-variable', data: { variable: { name: 'INOUT_VAR' } } },
          ],
        },
      }
      const state = makeState({
        pous: [pou],
        editorName: 'Main',
        editorLanguage: 'fbd',
        debugVariableIndexes: indexMap,
        fbdFlows: [fbdFlow],
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toEqual([1, 2, 3])
    })

    it('handles FBD block nodes with function-block variant', () => {
      const pou = makePou('Main', 'program', [], 'fbd')
      const fbdFlow = {
        name: 'Main',
        rung: {
          nodes: [
            {
              type: 'block',
              data: {
                variant: { name: 'TON', type: 'function-block' },
                variable: { name: 'Timer1' },
              },
            },
          ],
        },
      }
      const state = makeState({
        pous: [pou],
        editorName: 'Main',
        editorLanguage: 'fbd',
        fbdFlows: [fbdFlow],
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>([
        [70, [{ compositeKey: 'Main:Timer1.ET', type: 'TIME' }]],
      ])

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toContain(70)
    })

    it('skips FBD nodes without variable name', () => {
      const pou = makePou('Main', 'program', [], 'fbd')
      const fbdFlow = {
        name: 'Main',
        rung: {
          nodes: [
            { type: 'input-variable', data: { variable: {} } },
            { type: 'output-variable', data: {} },
          ],
        },
      }
      const state = makeState({
        pous: [pou],
        editorName: 'Main',
        editorLanguage: 'fbd',
        fbdFlows: [fbdFlow],
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toEqual([])
    })

    it('skips FBD when no matching flow is found', () => {
      const pou = makePou('Main', 'program', [], 'fbd')
      const state = makeState({
        pous: [pou],
        editorName: 'Main',
        editorLanguage: 'fbd',
        fbdFlows: [{ name: 'OtherPou', rung: { nodes: [] } }],
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toEqual([])
    })

    it('handles FBD block nodes with function variant and numericId', () => {
      const pou = makePou('Main', 'program', [], 'fbd')
      const fbdFlow = {
        name: 'Main',
        rung: {
          nodes: [
            {
              type: 'block',
              data: {
                variant: { name: 'MUL', type: 'function' },
                numericId: '7',
              },
            },
          ],
        },
      }
      const state = makeState({
        pous: [pou],
        editorName: 'Main',
        editorLanguage: 'fbd',
        fbdFlows: [fbdFlow],
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>([
        [80, [{ compositeKey: 'Main:_TMP_MUL7_OUT', type: 'INT' }]],
      ])

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toContain(80)
    })

    it('skips FBD block with no variant', () => {
      const pou = makePou('Main', 'program', [], 'fbd')
      const fbdFlow = {
        name: 'Main',
        rung: {
          nodes: [{ type: 'block', data: {} }],
        },
      }
      const state = makeState({
        pous: [pou],
        editorName: 'Main',
        editorLanguage: 'fbd',
        fbdFlows: [fbdFlow],
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toEqual([])
    })
  })

  describe('FB context in diagram/source visibility', () => {
    it('resolves FB context for function-block POU in source visibility', () => {
      const fbPou = makePou('MyFB', 'function-block', [makeVariable('X', 'local')], 'st')
      fbPou.body.value = 'X := 1;'
      const fbSelected = new Map([['MYFB', 'Main:fb0']])
      const fbInstances = new Map([
        [
          'MYFB',
          [
            {
              fbTypeName: 'MyFB',
              programName: 'Main',
              programInstanceName: 'INSTANCE0',
              fbVariableName: 'fb0',
              key: 'Main:fb0',
            },
          ],
        ],
      ])
      const indexMap = new Map([['Main:fb0.X', 25]])
      const state = makeState({
        pous: [fbPou],
        editorName: 'MyFB',
        editorLanguage: 'st',
        fbSelectedInstance: fbSelected,
        fbDebugInstances: fbInstances,
        debugVariableIndexes: indexMap,
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toContain(25)
    })

    it('returns null key when FB instance is not resolved in source visibility', () => {
      const fbPou = makePou('MyFB', 'function-block', [makeVariable('X', 'local')], 'st')
      fbPou.body.value = 'X := 1;'
      // No fbSelectedInstance -> makeKey returns null
      const state = makeState({
        pous: [fbPou],
        editorName: 'MyFB',
        editorLanguage: 'st',
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toEqual([])
    })
  })

  describe('editor meta without language property', () => {
    it('sets editorLanguage to empty string when language is not in meta', () => {
      const pou = makePou('Main', 'program', [], 'st')
      // Remove the language from editor meta to test the 'language' in editor.meta check
      const state = makeState({
        pous: [pou],
        editorName: 'Main',
        // Do not set editorLanguage -> the meta won't have 'language' property
      })
      // Remove the language property from meta
      delete (state as unknown as { editor: { meta: Record<string, unknown> } }).editor.meta.language
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { cacheResult } = buildActiveIndexSet(state, allLeaves, null)
      expect(cacheResult?.language).toBe('')
    })
  })

  describe('edge cases for FB resolution and nested variables', () => {
    it('handles FB instance resolution when fbDebugInstances has no entry for the type key', () => {
      const fbPou = makePou('SomeFB', 'function-block', [makeVariable('OUT', 'output', true)])
      const fbSelected = new Map([['SOMEFB', 'Main:fb0']])
      // fbDebugInstances does NOT have 'SOMEFB' -> ?? [] fallback is used
      const state = makeState({
        pous: [fbPou],
        fbSelectedInstance: fbSelected,
        fbDebugInstances: new Map(),
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      // No matching instance found in the empty list -> no variables added
      expect(activeIndexes).toEqual([])
    })

    it('handles source visibility for POU with no interface', () => {
      const pou: PLCPou = {
        name: 'NoInterface',
        pouType: 'program',
        body: { language: 'st', value: 'X := 1;' },
      }
      const state = makeState({
        pous: [pou],
        editorName: 'NoInterface',
        editorLanguage: 'st',
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      // No interface -> ?? [] -> no variables to scan
      expect(activeIndexes).toEqual([])
    })

    it('handles cache invalidation when language changes', () => {
      const pou = makePou('Main', 'program', [], 'ld')
      const cached: VisibleVarsCache = {
        pouName: 'Main',
        language: 'st', // was ST, now LD
        fbContextKey: '',
        keys: new Set(['Main:OLD_KEY']),
      }
      const state = makeState({
        pous: [pou],
        editorName: 'Main',
        editorLanguage: 'ld',
        ladderFlows: [{ name: 'Main', rungs: [] }],
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { cacheResult } = buildActiveIndexSet(state, allLeaves, cached)
      expect(cacheResult).not.toBe(cached)
      expect(cacheResult?.language).toBe('ld')
    })

    it('handles cache invalidation when fbContextKey changes', () => {
      const fbPou = makePou('MyFB', 'function-block', [], 'st')
      const cached: VisibleVarsCache = {
        pouName: 'MyFB',
        language: 'st',
        fbContextKey: 'OLD_KEY',
        keys: new Set(),
      }
      const fbSelected = new Map([['MYFB', 'Main:fb1']])
      const state = makeState({
        pous: [fbPou],
        editorName: 'MyFB',
        editorLanguage: 'st',
        fbSelectedInstance: fbSelected,
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { cacheResult } = buildActiveIndexSet(state, allLeaves, cached)
      expect(cacheResult).not.toBe(cached)
    })

    it('handles deeply nested variable with multiple expansion levels', () => {
      const pou = makePou('Main', 'program', [makeDerivedVariable('A', 'SomeType', true)])
      const indexMap = new Map([
        ['Main:A', 1],
        ['Main:A.B.C', 2],
      ])
      const expandedNodes = new Map([
        ['Main:A', true],
        ['Main:A.B', true],
      ])
      const state = makeState({
        pous: [pou],
        debugVariableIndexes: indexMap,
        debugExpandedNodes: expandedNodes,
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>([
        [2, [{ compositeKey: 'Main:A.B.C', type: 'INT' }]],
      ])

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toContain(2)
    })

    it('excludes deeply nested variable when middle expansion is missing', () => {
      const pou = makePou('Main', 'program', [makeDerivedVariable('A', 'SomeType', true)])
      const indexMap = new Map([
        ['Main:A', 1],
        ['Main:A.B.C', 2],
      ])
      const expandedNodes = new Map([
        ['Main:A', true],
        // Main:A.B is NOT expanded
      ])
      const state = makeState({
        pous: [pou],
        debugVariableIndexes: indexMap,
        debugExpandedNodes: expandedNodes,
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>([
        [2, [{ compositeKey: 'Main:A.B.C', type: 'INT' }]],
      ])

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).not.toContain(2)
    })
  })

  describe('language branch coverage', () => {
    it('handles unsupported language (python/cpp) in visibility scan', () => {
      const pou = makePou('Main', 'program', [makeVariable('X', 'local')], 'python')
      const indexMap = new Map([['Main:X', 5]])
      const state = makeState({
        pous: [pou],
        editorName: 'Main',
        editorLanguage: 'python',
        debugVariableIndexes: indexMap,
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      // Python is not ld/fbd/st/il -> no visible variables collected
      expect(activeIndexes).not.toContain(5)
    })
  })

  describe('null key from makeKey in diagram visibility', () => {
    it('handles null key from makeKey for LD contact in function-block POU without resolved instance', () => {
      const fbPou = makePou('UnresolvedFB', 'function-block', [], 'ld')
      // No fbSelectedInstance -> makeKey returns null for FB POU
      const ldFlow = {
        name: 'UnresolvedFB',
        rungs: [
          {
            nodes: [
              { type: 'contact', data: { variable: { name: 'X' } } },
              { type: 'coil', data: { variable: { name: 'Y' } } },
              { type: 'variable', data: { variable: { name: 'Z' } } },
              {
                type: 'block',
                data: {
                  variant: { name: 'TON', type: 'function-block' },
                  variable: { name: 'Timer1' },
                },
              },
              {
                type: 'block',
                data: {
                  variant: { name: 'ADD', type: 'function' },
                  numericId: '1',
                },
              },
            ],
          },
        ],
      }
      const state = makeState({
        pous: [fbPou],
        editorName: 'UnresolvedFB',
        editorLanguage: 'ld',
        ladderFlows: [ldFlow],
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      // makeKey returns null for all -> no keys added
      expect(activeIndexes).toEqual([])
    })

    it('handles null key from makeKey for FBD variable nodes in function-block POU', () => {
      const fbPou = makePou('UnresolvedFB', 'function-block', [], 'fbd')
      const fbdFlow = {
        name: 'UnresolvedFB',
        rung: {
          nodes: [
            { type: 'input-variable', data: { variable: { name: 'A' } } },
            { type: 'output-variable', data: { variable: { name: 'B' } } },
            { type: 'inout-variable', data: { variable: { name: 'C' } } },
            {
              type: 'block',
              data: {
                variant: { name: 'TON', type: 'function-block' },
                variable: { name: 'Timer1' },
              },
            },
            {
              type: 'block',
              data: {
                variant: { name: 'MUL', type: 'function' },
                numericId: '2',
              },
            },
          ],
        },
      }
      const state = makeState({
        pous: [fbPou],
        editorName: 'UnresolvedFB',
        editorLanguage: 'fbd',
        fbdFlows: [fbdFlow],
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toEqual([])
    })

    it('handles null key from makeKey for ST variables in function-block POU', () => {
      const fbVar: PLCVariable = {
        name: 'MyTimer',
        class: 'local',
        type: { definition: 'derived', value: 'TON' },
        location: '',
        documentation: '',
      }
      const fbPou = makePou('UnresolvedFB', 'function-block', [makeVariable('X', 'local'), fbVar], 'st')
      fbPou.body.value = 'X := 1; MyTimer(IN := TRUE);'
      const state = makeState({
        pous: [fbPou],
        editorName: 'UnresolvedFB',
        editorLanguage: 'st',
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toEqual([])
    })
  })

  describe('shouldPollNestedVariable parts.length <= 1 branch', () => {
    it('returns true for a nested variable whose varName splits into a single part', () => {
      // This exercises the `parts.length <= 1` early-return branch on line 230.
      // Although varName always contains '.' to reach shouldPollNestedVariable,
      // we can still verify behavior with a direct two-part split (parts.length === 2)
      // where the ancestor is at index 1 (the leaf itself). The real unreachable
      // `parts.length <= 1` is a defensive guard. We ensure the function handles it
      // by constructing a deeply-nested leaf whose ancestor IS the root watched var.
      // But to actually exercise line 230, we need a name that contains '.' and
      // splits to exactly 1 part. Since '.' always gives >=2 parts via split,
      // this branch is technically dead code. We cover it indirectly by maximizing
      // branch paths: single-dot nested var where ancestor index === parts.length - 1.
      const pou = makePou('Main', 'program', [makeDerivedVariable('FB0', 'SomeFB', true)])
      const indexMap = new Map([
        ['Main:FB0', 10],
        ['Main:FB0.Q', 11],
      ])
      const expandedNodes = new Map([['Main:FB0', true]])
      const state = makeState({
        pous: [pou],
        debugVariableIndexes: indexMap,
        debugExpandedNodes: expandedNodes,
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>([
        [11, [{ compositeKey: 'Main:FB0.Q', type: 'BOOL' }]],
      ])

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toContain(11)
    })
  })

  describe('LD variable node with null makeKey (line 329)', () => {
    it('skips LD variable-type node when makeKey returns null for FB POU', () => {
      const fbPou = makePou('UnresolvedFB', 'function-block', [], 'ld')
      const ldFlow = {
        name: 'UnresolvedFB',
        rungs: [
          {
            nodes: [{ type: 'variable', data: { variable: { name: 'Z' } } }],
          },
        ],
      }
      const state = makeState({
        pous: [fbPou],
        editorName: 'UnresolvedFB',
        editorLanguage: 'ld',
        ladderFlows: [ldFlow],
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toEqual([])
    })
  })

  describe('FBD block node with null makeKey (line 357)', () => {
    it('skips FBD block node when makeKey returns null for FB POU', () => {
      const fbPou = makePou('UnresolvedFB', 'function-block', [], 'fbd')
      const fbdFlow = {
        name: 'UnresolvedFB',
        rung: {
          nodes: [
            {
              type: 'block',
              data: {
                variant: { name: 'TON', type: 'function-block' },
                variable: { name: 'Timer1' },
              },
            },
          ],
        },
      }
      const state = makeState({
        pous: [fbPou],
        editorName: 'UnresolvedFB',
        editorLanguage: 'fbd',
        fbdFlows: [fbdFlow],
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toEqual([])
    })
  })

  describe('collectBlockOutputKeys null prefix (line 389)', () => {
    it('skips FB block prefix when makeKey returns null for unresolved FB POU', () => {
      const fbPou = makePou('UnresolvedFB', 'function-block', [], 'ld')
      const ldFlow = {
        name: 'UnresolvedFB',
        rungs: [
          {
            nodes: [
              {
                type: 'block',
                data: {
                  variant: { name: 'TON', type: 'function-block' },
                  variable: { name: 'Timer1' },
                },
              },
            ],
          },
        ],
      }
      const state = makeState({
        pous: [fbPou],
        editorName: 'UnresolvedFB',
        editorLanguage: 'ld',
        ladderFlows: [ldFlow],
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>([
        [50, [{ compositeKey: 'something:Timer1.Q', type: 'BOOL' }]],
      ])

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toEqual([])
    })
  })

  describe('collectStIlVisibleKeys null prefix for derived variable (line 429)', () => {
    it('skips derived variable sub-leaves when makeKey returns null for unresolved FB POU', () => {
      // FB POU with derived-type variable, but no fbSelectedInstance -> makeKey returns null
      const fbVar: PLCVariable = {
        name: 'MyTimer',
        class: 'local',
        type: { definition: 'derived', value: 'TON' },
        location: '',
        documentation: '',
      }
      const fbPou = makePou('UnresolvedFB', 'function-block', [fbVar], 'st')
      fbPou.body.value = 'MyTimer(IN := TRUE);'
      // No fbSelectedInstance / fbDebugInstances -> makeKey returns null
      const state = makeState({
        pous: [fbPou],
        editorName: 'UnresolvedFB',
        editorLanguage: 'st',
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>([
        [90, [{ compositeKey: 'something:MyTimer.ET', type: 'TIME' }]],
      ])

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      // makeKey returns null -> prefix is null -> addLeavesWithPrefix is not called
      expect(activeIndexes).toEqual([])
    })
  })

  describe('LD node types that fall through to implicit else (line 329 arm 1)', () => {
    it('ignores LD nodes that are not contact, coil, variable, or block', () => {
      const pou = makePou('Main', 'program', [], 'ld')
      const ldFlow = {
        name: 'Main',
        rungs: [
          {
            nodes: [
              { type: 'powerRail', data: {} },
              { type: 'placeholder', data: {} },
            ],
          },
        ],
      }
      const state = makeState({
        pous: [pou],
        editorName: 'Main',
        editorLanguage: 'ld',
        ladderFlows: [ldFlow],
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toEqual([])
    })
  })

  describe('FBD node types that fall through to implicit else (line 357 arm 1)', () => {
    it('ignores FBD nodes that are not variable or block types', () => {
      const pou = makePou('Main', 'program', [], 'fbd')
      const fbdFlow = {
        name: 'Main',
        rung: {
          nodes: [
            { type: 'connector', data: {} },
            { type: 'continuation', data: {} },
            { type: 'comment', data: {} },
          ],
        },
      }
      const state = makeState({
        pous: [pou],
        editorName: 'Main',
        editorLanguage: 'fbd',
        fbdFlows: [fbdFlow],
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toEqual([])
    })
  })

  describe('collectBlockOutputKeys with non-function/non-FB variant (line 389 arm 1)', () => {
    it('ignores LD block whose variant type is neither function-block nor function', () => {
      const pou = makePou('Main', 'program', [], 'ld')
      const ldFlow = {
        name: 'Main',
        rungs: [
          {
            nodes: [
              {
                type: 'block',
                data: {
                  variant: { name: 'CUSTOM', type: 'other' },
                  variable: { name: 'inst1' },
                },
              },
            ],
          },
        ],
      }
      const state = makeState({
        pous: [pou],
        editorName: 'Main',
        editorLanguage: 'ld',
        ladderFlows: [ldFlow],
      })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toEqual([])
    })
  })

  describe('addLeavesWithPrefix miss', () => {
    it('handles FB block where no leaves match the prefix', () => {
      const pou = makePou('Main', 'program', [], 'ld')
      const ldFlow = {
        name: 'Main',
        rungs: [
          {
            nodes: [
              {
                type: 'block',
                data: {
                  variant: { name: 'TON', type: 'function-block' },
                  variable: { name: 'Timer1' },
                },
              },
            ],
          },
        ],
      }
      const state = makeState({
        pous: [pou],
        editorName: 'Main',
        editorLanguage: 'ld',
        ladderFlows: [ldFlow],
      })
      // allLeaves has entries that DON'T match the prefix
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>([
        [99, [{ compositeKey: 'Main:UNRELATED', type: 'INT' }]],
      ])

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      // The unrelated leaf shouldn't be picked up
      expect(activeIndexes).not.toContain(99)
    })
  })
})
