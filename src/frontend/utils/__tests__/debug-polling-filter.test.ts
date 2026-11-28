import type { PLCPou, PLCVariable } from '../../../middleware/shared/ports/types'
import { buildActiveIndexSet, type DebugViewport, type VisibleVarsCache } from '../debug-polling-filter'

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
  debugPanelVisibleKeys?: string[]
  debugEditorViewport?: DebugViewport | null
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
      debugPanelVisibleKeys: overrides.debugPanelVisibleKeys ?? [],
      debugEditorViewport: overrides.debugEditorViewport ?? null,
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

  describe('debugger panel rows on screen', () => {
    it('polls the rows the panel reports on screen', () => {
      const indexMap = new Map([
        ['Main:SPEED', 10],
        ['Main:TEMP', 11],
      ])
      const state = makeState({ debugPanelVisibleKeys: ['Main:SPEED'], debugVariableIndexes: indexMap })

      const { activeIndexes } = buildActiveIndexSet(state, new Map(), null)
      expect(activeIndexes).toEqual([10])
    })

    it('does not poll watched variables the panel has scrolled out of view or hidden', () => {
      const pou = makePou('Main', 'program', [makeVariable('SPEED', 'local', true)])
      const state = makeState({ pous: [pou], debugVariableIndexes: new Map([['Main:SPEED', 10]]) })

      const { activeIndexes } = buildActiveIndexSet(state, new Map(), null)
      expect(activeIndexes).toEqual([])
    })

    it('polls only the on-screen elements of an expanded array', () => {
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>()
      for (let i = 0; i < 1000; i++) allLeaves.set(100 + i, [{ compositeKey: `Main:ARR[${i}]`, type: 'INT' }])
      const state = makeState({ debugPanelVisibleKeys: ['Main:ARR', 'Main:ARR[0]', 'Main:ARR[1]', 'Main:ARR[2]'] })

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toEqual([100, 101, 102])
    })

    it('keeps forced and graphed variables polled while they are off screen', () => {
      const indexMap = new Map([
        ['Main:FORCED', 1],
        ['Main:PLOTTED', 2],
        ['Main:SHOWN', 3],
      ])
      const state = makeState({
        debugPanelVisibleKeys: ['Main:SHOWN'],
        debugForcedVariables: new Map([['Main:FORCED', true]]),
        debugGraphList: ['Main:PLOTTED'],
        debugVariableIndexes: indexMap,
      })

      const { activeIndexes } = buildActiveIndexSet(state, new Map(), null)
      expect(activeIndexes).toEqual([1, 2, 3])
    })

    it('polls every index that carries an on-screen key', () => {
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>([
        [4, [{ compositeKey: 'Main:SHARED', type: 'INT' }]],
        [9, [{ compositeKey: 'Main:SHARED', type: 'INT' }]],
      ])
      const state = makeState({ debugPanelVisibleKeys: ['Main:SHARED'] })

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toEqual([4, 9])
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

  describe('ST/IL source-visible VAR_EXTERNAL globals', () => {
    it('polls a global the source references through VAR_EXTERNAL by its canonical key', () => {
      const pou = makePou('Main', 'program', [makeVariable('g_count', 'external'), makeVariable('x')], 'st')
      pou.body = { language: 'st', value: 'x := g_count + 1;' }
      const state = makeState({
        pous: [pou],
        editorName: 'Main',
        editorLanguage: 'st',
        debugVariableIndexes: new Map([
          ['Config0:g_count', 5],
          ['Main:x', 6],
          ['Main:g_count', 7],
        ]),
      })

      const { activeIndexes } = buildActiveIndexSet(state, new Map(), null)
      expect(activeIndexes).toEqual([5, 6])
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
        viewKey: '',
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
        viewKey: '',
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
        viewKey: '',
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
      const state = makeState({ debugPanelVisibleKeys: ['Main:A'] })
      const allLeaves = new Map<number, { compositeKey: string; type: string }[]>([
        [42, [{ compositeKey: 'Main:A', type: 'INT' }]],
      ])

      const { activeIndexes } = buildActiveIndexSet(state, allLeaves, null)
      expect(activeIndexes).toEqual([42])
    })

    it('returns sorted indexes', () => {
      const indexMap = new Map([
        ['Main:C', 30],
        ['Main:A', 10],
        ['Main:B', 20],
      ])
      const state = makeState({ debugPanelVisibleKeys: ['Main:C', 'Main:A', 'Main:B'], debugVariableIndexes: indexMap })
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

    it('polls a contact and a coil on a VAR_EXTERNAL global through its canonical key, member path included', () => {
      const pou = makePou('Main', 'program', [makeVariable('g_plant', 'external'), makeVariable('lp')], 'ld')
      const indexMap = new Map([
        ['Config0:g_plant.LINES[2].RUNNING', 1],
        ['Main:lp.LINES[2].RUNNING', 2],
        ['Main:g_plant.LINES[2].RUNNING', 3],
      ])
      const ldFlow = {
        name: 'Main',
        rungs: [
          {
            nodes: [
              { type: 'contact', data: { variable: { name: 'g_plant.LINES[2].RUNNING' } } },
              { type: 'coil', data: { variable: { name: 'lp.LINES[2].RUNNING' } } },
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

      const { activeIndexes } = buildActiveIndexSet(state, new Map(), null)
      expect(activeIndexes).toEqual([1, 2])
    })

    it('polls the edge trigger output of rising and falling contacts, not only their variable', () => {
      const pou = makePou('Main', 'program', [], 'ld')
      const indexMap = new Map([
        ['Main:LED', 1],
        ['Main:_TMP_R_TRIG42.Q', 2],
        ['Main:_TMP_F_TRIG43.Q', 3],
        ['Main:_TMP_R_TRIG44.Q', 4],
      ])
      const ldFlow = {
        name: 'Main',
        rungs: [
          {
            nodes: [
              { type: 'contact', data: { variant: 'risingEdge', numericId: '42', variable: { name: 'LED' } } },
              { type: 'contact', data: { variant: 'fallingEdge', numericId: '43', variable: { name: 'LED' } } },
              { type: 'coil', data: { variant: 'risingEdge', numericId: '44', variable: { name: 'LED' } } },
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
      expect(activeIndexes).toEqual(expect.arrayContaining([1, 2, 3]))
      expect(activeIndexes).not.toContain(4)
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
        viewKey: '',
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
        viewKey: '',
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

describe('ST/IL lines on screen', () => {
  const source = ['A := 1;', 'B := 2;', 'C := 3;', 'TMR(IN := TRUE);'].join('\r\n')
  const pou: PLCPou = {
    name: 'Main',
    pouType: 'program',
    interface: {
      variables: [makeVariable('A'), makeVariable('B'), makeVariable('C'), makeDerivedVariable('TMR', 'TON')],
    },
    body: { language: 'st', value: source },
  }
  const indexes = new Map([
    ['Main:A', 1],
    ['Main:B', 2],
    ['Main:C', 3],
  ])
  const leaves = new Map([
    [10, [{ compositeKey: 'Main:TMR.Q', type: 'BOOL' }]],
    [11, [{ compositeKey: 'Main:TMR.ET', type: 'TIME' }]],
  ])
  const poll = (debugEditorViewport: DebugViewport | null, cache = null) =>
    buildActiveIndexSet(
      makeState({
        pous: [pou],
        editorName: 'Main',
        editorLanguage: 'st',
        debugVariableIndexes: indexes,
        debugEditorViewport,
      }),
      leaves,
      cache,
    )

  it('polls only the variables on the lines the editor shows', () => {
    expect(poll({ pouName: 'Main', lines: [[2, 2]] }).activeIndexes).toEqual([2])
  })

  it('polls the variables of every visible range, including FB instance members', () => {
    expect(
      poll({
        pouName: 'Main',
        lines: [
          [1, 1],
          [4, 4],
        ],
      }).activeIndexes,
    ).toEqual([1, 10, 11])
  })

  it('scans the whole body while the editor has not reported this POU', () => {
    expect(poll({ pouName: 'Other', lines: [[2, 2]] }).activeIndexes).toEqual([1, 2, 3, 10, 11])
    expect(poll(null).activeIndexes).toEqual([1, 2, 3, 10, 11])
  })

  it('polls nothing from the source while the editor shows no lines', () => {
    expect(poll({ pouName: 'Main', lines: [] }).activeIndexes).toEqual([])
  })

  it('rescans when the visible lines change and reuses the scan while they do not', () => {
    const first = poll({ pouName: 'Main', lines: [[1, 2]] })
    const same = poll({ pouName: 'Main', lines: [[1, 2]] }, first.cacheResult as never)
    expect(same.cacheResult).toBe(first.cacheResult)
    const scrolled = poll({ pouName: 'Main', lines: [[3, 4]] }, first.cacheResult as never)
    expect(scrolled.cacheResult).not.toBe(first.cacheResult)
    expect(scrolled.activeIndexes).toEqual([3, 10, 11])
  })
})

describe('LD rungs and FBD nodes on screen', () => {
  const ldPou = makePou('Ladder', 'program', [], 'ld')
  const fbdPou = makePou('Diagram', 'program', [], 'fbd')
  const indexes = new Map([
    ['Ladder:X1', 1],
    ['Ladder:Y1', 2],
    ['Ladder:X2', 3],
    ['Ladder:Y2', 4],
    ['Diagram:IN1', 5],
    ['Diagram:OUT1', 6],
    ['Diagram:IN2', 7],
  ])
  const leaves = new Map([
    [10, [{ compositeKey: 'Ladder:TMR.Q', type: 'BOOL' }]],
    [11, [{ compositeKey: 'Diagram:CNT.CV', type: 'INT' }]],
  ])
  const ladderFlows = [
    {
      name: 'Ladder',
      rungs: [
        {
          id: 'r1',
          nodes: [
            { id: 'c1', type: 'contact', data: { variable: { name: 'X1' } } },
            { id: 'o1', type: 'coil', data: { variable: { name: 'Y1' } } },
          ],
        },
        {
          id: 'r2',
          nodes: [
            { id: 'c1', type: 'contact', data: { variable: { name: 'X2' } } },
            {
              id: 'b1',
              type: 'block',
              data: { variant: { name: 'TON', type: 'function-block' }, variable: { name: 'TMR' } },
            },
            { id: 'o1', type: 'coil', data: { variable: { name: 'Y2' } } },
          ],
        },
      ],
    },
  ]
  const fbdFlows = [
    {
      name: 'Diagram',
      rung: {
        nodes: [
          { id: 'n1', type: 'input-variable', data: { variable: { name: 'IN1' } } },
          { id: 'n2', type: 'output-variable', data: { variable: { name: 'OUT1' } } },
          { id: 'n3', type: 'input-variable', data: { variable: { name: 'IN2' } } },
          {
            id: 'n4',
            type: 'block',
            data: { variant: { name: 'CTU', type: 'function-block' }, variable: { name: 'CNT' } },
          },
        ],
      },
    },
  ]
  const poll = (pou: PLCPou, debugEditorViewport: DebugViewport | null, cache: VisibleVarsCache = null) =>
    buildActiveIndexSet(
      makeState({
        pous: [ldPou, fbdPou],
        editorName: pou.name,
        editorLanguage: pou.body.language,
        debugVariableIndexes: indexes,
        debugEditorViewport,
        ladderFlows,
        fbdFlows,
      }),
      leaves,
      cache,
    )

  it('polls only the variables of the LD rungs on screen', () => {
    expect(poll(ldPou, { pouName: 'Ladder', elementIds: ['r1'] }).activeIndexes).toEqual([1, 2])
    expect(poll(ldPou, { pouName: 'Ladder', elementIds: ['r2'] }).activeIndexes).toEqual([3, 4, 10])
  })

  it('polls only the variables of the FBD nodes on screen', () => {
    expect(poll(fbdPou, { pouName: 'Diagram', elementIds: ['n2', 'n4'] }).activeIndexes).toEqual([6, 11])
  })

  it('polls every rung or node while the editor has not reported this POU, and none when nothing is on screen', () => {
    expect(poll(ldPou, null).activeIndexes).toEqual([1, 2, 3, 4, 10])
    expect(poll(ldPou, { pouName: 'Other', elementIds: [] }).activeIndexes).toEqual([1, 2, 3, 4, 10])
    expect(poll(fbdPou, { pouName: 'Diagram', lines: [[1, 3]] }).activeIndexes).toEqual([5, 6, 7, 11])
    expect(poll(ldPou, { pouName: 'Ladder', elementIds: [] }).activeIndexes).toEqual([])
  })

  it('rescans when the elements on screen change and reuses the scan while they do not', () => {
    const first = poll(fbdPou, { pouName: 'Diagram', elementIds: ['n1'] })
    const same = poll(fbdPou, { pouName: 'Diagram', elementIds: ['n1'] }, first.cacheResult)
    expect(same.cacheResult).toBe(first.cacheResult)
    const panned = poll(fbdPou, { pouName: 'Diagram', elementIds: ['n3'] }, first.cacheResult)
    expect(panned.cacheResult).not.toBe(first.cacheResult)
    expect(panned.activeIndexes).toEqual([7])
  })
})
