import type { PLCPou } from '../../../middleware/shared/ports/types'
import type { EditorLike } from '../save-project'
import { collectDebugVariables, sanitizePou } from '../save-project'

// ---------------------------------------------------------------------------
// sanitizePou
// ---------------------------------------------------------------------------

describe('sanitizePou', () => {
  const basePou: PLCPou = {
    name: 'MyProgram',
    pouType: 'program',
    interface: { variables: [] },
    body: { language: 'st', value: '' },
    documentation: '',
  }

  it('returns the POU unchanged when editor is undefined', () => {
    expect(sanitizePou(basePou, undefined)).toBe(basePou)
  })

  it('returns the POU unchanged when editor type is not plc-textual or plc-graphical', () => {
    const editor: EditorLike = {
      type: 'other',
      meta: { name: 'MyProgram' },
      variable: { display: 'code', code: 'VAR\nEND_VAR' },
    }
    expect(sanitizePou(basePou, editor)).toBe(basePou)
  })

  it('returns the POU unchanged when editor has no variable property', () => {
    const editor: EditorLike = {
      type: 'plc-textual',
      meta: { name: 'MyProgram' },
    }
    expect(sanitizePou(basePou, editor)).toBe(basePou)
  })

  it('returns the POU unchanged when display is not code', () => {
    const editor: EditorLike = {
      type: 'plc-textual',
      meta: { name: 'MyProgram' },
      variable: { display: 'table' },
    }
    expect(sanitizePou(basePou, editor)).toBe(basePou)
  })

  it('returns the POU unchanged when display is code but code is null', () => {
    const editor: EditorLike = {
      type: 'plc-textual',
      meta: { name: 'MyProgram' },
      variable: { display: 'code', code: null },
    }
    expect(sanitizePou(basePou, editor)).toBe(basePou)
  })

  it('returns the POU unchanged when display is code but code is undefined', () => {
    const editor: EditorLike = {
      type: 'plc-textual',
      meta: { name: 'MyProgram' },
      variable: { display: 'code' },
    }
    expect(sanitizePou(basePou, editor)).toBe(basePou)
  })

  it('merges variablesText from editor when display is code and code is a non-null string', () => {
    const editor: EditorLike = {
      type: 'plc-textual',
      meta: { name: 'MyProgram' },
      variable: { display: 'code', code: 'VAR\n  x : INT;\nEND_VAR' },
    }
    const result = sanitizePou(basePou, editor)
    expect(result).not.toBe(basePou)
    expect((result as PLCPou & { variablesText?: string }).variablesText).toBe('VAR\n  x : INT;\nEND_VAR')
    expect(result.name).toBe(basePou.name)
  })

  it('works with plc-graphical editor type', () => {
    const editor: EditorLike = {
      type: 'plc-graphical',
      meta: { name: 'MyProgram' },
      variable: { display: 'code', code: 'VAR\nEND_VAR' },
    }
    const result = sanitizePou(basePou, editor)
    expect((result as PLCPou & { variablesText?: string }).variablesText).toBe('VAR\nEND_VAR')
  })

  it('returns POU with empty string code', () => {
    const editor: EditorLike = {
      type: 'plc-textual',
      meta: { name: 'MyProgram' },
      variable: { display: 'code', code: '' },
    }
    const result = sanitizePou(basePou, editor)
    expect((result as PLCPou & { variablesText?: string }).variablesText).toBe('')
  })
})

// ---------------------------------------------------------------------------
// graphical node sanitization (via sanitizePou → stripGraphicalSelections)
// ---------------------------------------------------------------------------

describe('graphical node sanitization', () => {
  const makeLdPou = (nodes: unknown[], rungExtras?: Record<string, unknown>): PLCPou =>
    ({
      name: 'MyLadder',
      pouType: 'program',
      interface: { variables: [] },
      body: {
        language: 'ld',
        value: {
          name: 'MyLadder',
          rungs: [{ id: 'rung-1', nodes, edges: [], selectedNodes: [{ id: 'ghost' }], ...rungExtras }],
        },
      },
      documentation: '',
    }) as unknown as PLCPou

  it('clears selection state and resets selectedNodes on LD rungs', () => {
    const pou = makeLdPou([{ id: 'n1', selected: true, dragging: true, draggable: true, data: { draggable: true } }])
    const value = sanitizePou(pou, undefined).body.value as {
      rungs: { selectedNodes: unknown[]; nodes: Record<string, unknown>[] }[]
    }
    expect(value.rungs[0].selectedNodes).toEqual([])
    expect(value.rungs[0].nodes[0].selected).toBe(false)
    expect(value.rungs[0].nodes[0].dragging).toBe(false)
  })

  it('strips the hasDivergence render decoration from LD node data', () => {
    const pou = makeLdPou([
      { id: 'n1', draggable: true, data: { draggable: true, hasDivergence: false, variable: { name: 'X' } } },
    ])
    const value = sanitizePou(pou, undefined).body.value as { rungs: { nodes: { data: Record<string, unknown> }[] }[] }
    expect('hasDivergence' in value.rungs[0].nodes[0].data).toBe(false)
    expect(value.rungs[0].nodes[0].data.variable).toEqual({ name: 'X' })
  })

  it('normalizes top-level draggable to the design-time data.draggable', () => {
    const pou = makeLdPou([
      { id: 'locked', draggable: false, data: { draggable: true } },
      { id: 'rail', draggable: true, data: { draggable: false } },
      { id: 'no-data' },
    ])
    const value = sanitizePou(pou, undefined).body.value as { rungs: { nodes: Record<string, unknown>[] }[] }
    expect(value.rungs[0].nodes[0].draggable).toBe(true)
    expect(value.rungs[0].nodes[1].draggable).toBe(false)
    expect(value.rungs[0].nodes[2].draggable).toBe(false)
    expect('data' in value.rungs[0].nodes[2]).toBe(false)
  })

  it('leaves non-array LD rung nodes untouched', () => {
    const pou = makeLdPou([], {})
    ;(pou.body.value as { rungs: Record<string, unknown>[] }).rungs[0].nodes = 'not-an-array'
    const value = sanitizePou(pou, undefined).body.value as { rungs: { nodes: unknown }[] }
    expect(value.rungs[0].nodes).toBe('not-an-array')
  })

  it('sanitizes FBD rung nodes the same way', () => {
    const pou = {
      name: 'MyFbd',
      pouType: 'program',
      interface: { variables: [] },
      body: {
        language: 'fbd',
        value: {
          name: 'MyFbd',
          rung: {
            nodes: [
              {
                id: 'n1',
                selected: true,
                dragging: true,
                draggable: false,
                data: { draggable: true, hasDivergence: true },
              },
            ],
            edges: [],
            selectedNodes: [{ id: 'ghost' }],
          },
        },
      },
      documentation: '',
    } as unknown as PLCPou
    const value = sanitizePou(pou, undefined).body.value as {
      rung: {
        selectedNodes: unknown[]
        nodes: { selected: boolean; dragging: boolean; draggable: boolean; data: Record<string, unknown> }[]
      }
    }
    expect(value.rung.selectedNodes).toEqual([])
    expect(value.rung.nodes[0].selected).toBe(false)
    expect(value.rung.nodes[0].dragging).toBe(false)
    expect(value.rung.nodes[0].draggable).toBe(true)
    expect('hasDivergence' in value.rung.nodes[0].data).toBe(false)
  })

  it('returns the POU unchanged when the graphical body value is missing', () => {
    const pou = {
      name: 'Empty',
      pouType: 'program',
      interface: { variables: [] },
      body: { language: 'ld', value: undefined },
      documentation: '',
    } as unknown as PLCPou
    expect(sanitizePou(pou, undefined)).toBe(pou)
  })

  it('preserves LD rung edge order (layout algorithms may be order-sensitive)', () => {
    const edges = [
      { id: 'e_charlie', source: 'c', target: 'd' },
      { id: 'e_alpha', source: 'a', target: 'b' },
      { id: 'e_bravo', source: 'b', target: 'c' },
    ]
    const pou = makeLdPou([], { edges })
    const value = sanitizePou(pou, undefined).body.value as { rungs: { edges: { id: string }[] }[] }
    expect(value.rungs[0].edges.map((e) => e.id)).toEqual(['e_charlie', 'e_alpha', 'e_bravo'])
  })

  it('canonicalizes reactFlowViewport from node content bounds', () => {
    const pou = makeLdPou(
      [{ id: 'n1', position: { x: 200, y: 10 }, width: 100, height: 60, draggable: true, data: { draggable: true } }],
      { defaultBounds: [100, 50], reactFlowViewport: [999, 999] },
    )
    const value = sanitizePou(pou, undefined).body.value as { rungs: { reactFlowViewport: number[] }[] }
    // bounds include the synthetic 150x40 origin node: maxX=300, maxY=70 -> [300, 70+20]
    expect(value.rungs[0].reactFlowViewport).toEqual([300, 90])
  })

  it('floors the canonical viewport at defaultBounds', () => {
    const pou = makeLdPou(
      [{ id: 'n1', position: { x: 10, y: 10 }, width: 10, height: 10, draggable: true, data: { draggable: true } }],
      { defaultBounds: [800, 200], reactFlowViewport: [123, 456] },
    )
    const value = sanitizePou(pou, undefined).body.value as { rungs: { reactFlowViewport: number[] }[] }
    expect(value.rungs[0].reactFlowViewport).toEqual([800, 220])
  })

  it('prefers measured dimensions over declared width/height for the viewport', () => {
    const pou = makeLdPou(
      [
        {
          id: 'n1',
          position: { x: 400, y: 0 },
          width: 999,
          height: 999,
          measured: { width: 50, height: 30 },
          draggable: true,
          data: { draggable: true },
        },
      ],
      { defaultBounds: [10, 10], reactFlowViewport: [1, 1] },
    )
    const value = sanitizePou(pou, undefined).body.value as { rungs: { reactFlowViewport: number[] }[] }
    expect(value.rungs[0].reactFlowViewport).toEqual([450, 60])
  })

  it('passes the stored viewport through when the rung has no defaultBounds', () => {
    const pou = makeLdPou([], { reactFlowViewport: [111, 222] })
    const value = sanitizePou(pou, undefined).body.value as { rungs: { reactFlowViewport: number[] }[] }
    expect(value.rungs[0].reactFlowViewport).toEqual([111, 222])
  })

  it('expands the viewport for negative positions and tolerates nodes without geometry', () => {
    const pou = makeLdPou(
      [
        { id: 'neg', position: { x: -50, y: -30 }, width: 10, height: 10, draggable: true, data: { draggable: true } },
        { id: 'bare', draggable: true, data: { draggable: true } },
      ],
      { defaultBounds: [10, 10], reactFlowViewport: [1, 1] },
    )
    const value = sanitizePou(pou, undefined).body.value as { rungs: { reactFlowViewport: number[] }[] }
    // minX=-50, minY=-30; max bounds stay at the synthetic 150x40 -> [200, 70+20]
    expect(value.rungs[0].reactFlowViewport).toEqual([200, 90])
  })

  it('treats non-numeric defaultBounds entries as zero for the viewport floor', () => {
    const pou = makeLdPou(
      [{ id: 'n1', position: { x: 0, y: 0 }, width: 10, height: 10, draggable: true, data: { draggable: true } }],
      { defaultBounds: ['not-a-number', null], reactFlowViewport: [9, 9] },
    )
    const value = sanitizePou(pou, undefined).body.value as { rungs: { reactFlowViewport: number[] }[] }
    // Floors collapse to 0 -> pure content bounds (synthetic origin node 150x40).
    expect(value.rungs[0].reactFlowViewport).toEqual([150, 60])
  })

  it('leaves non-array FBD rung nodes untouched', () => {
    const pou = {
      name: 'MyFbd',
      pouType: 'program',
      interface: { variables: [] },
      body: {
        language: 'fbd',
        value: { name: 'MyFbd', rung: { nodes: 'not-an-array', edges: [], selectedNodes: [] } },
      },
      documentation: '',
    } as unknown as PLCPou
    const value = sanitizePou(pou, undefined).body.value as { rung: { nodes: unknown } }
    expect(value.rung.nodes).toBe('not-an-array')
  })

  it('returns the POU unchanged when an LD body has no rungs array', () => {
    const pou = {
      name: 'NoRungs',
      pouType: 'program',
      interface: { variables: [] },
      body: { language: 'ld', value: { name: 'NoRungs' } },
      documentation: '',
    } as unknown as PLCPou
    expect(sanitizePou(pou, undefined)).toBe(pou)
  })
})

// ---------------------------------------------------------------------------
// collectDebugVariables
// ---------------------------------------------------------------------------

describe('collectDebugVariables', () => {
  it('returns undefined when no variables have debug enabled', () => {
    const globalVars = [{ name: 'g1', debug: false }]
    const pous: PLCPou[] = [
      {
        name: 'P1',
        pouType: 'program',
        interface: {
          variables: [
            {
              name: 'x',
              type: { definition: 'base-type', value: 'INT' },
              location: '',
              documentation: '',
              debug: false,
            },
          ],
        },
        body: { language: 'st', value: '' },
      },
    ]
    expect(collectDebugVariables(globalVars, pous)).toBeUndefined()
  })

  it('returns undefined when variables array is empty', () => {
    expect(collectDebugVariables([], [])).toBeUndefined()
  })

  it('returns only global debug variables when only globals have debug', () => {
    const globalVars = [
      { name: 'g1', debug: true },
      { name: 'g2', debug: false },
      { name: 'g3', debug: true },
    ]
    const result = collectDebugVariables(globalVars, [])
    expect(result).toEqual({ global: ['g1', 'g3'] })
  })

  it('returns only pou debug variables when only pous have debug', () => {
    const globalVars = [{ name: 'g1', debug: false }]
    const pous: PLCPou[] = [
      {
        name: 'P1',
        pouType: 'program',
        interface: {
          variables: [
            {
              name: 'a',
              type: { definition: 'base-type', value: 'INT' },
              location: '',
              documentation: '',
              debug: true,
            },
            {
              name: 'b',
              type: { definition: 'base-type', value: 'INT' },
              location: '',
              documentation: '',
              debug: false,
            },
          ],
        },
        body: { language: 'st', value: '' },
      },
    ]
    const result = collectDebugVariables(globalVars, pous)
    expect(result).toEqual({ pous: { P1: ['a'] } })
  })

  it('returns both global and pou debug variables', () => {
    const globalVars = [{ name: 'gDebug', debug: true }]
    const pous: PLCPou[] = [
      {
        name: 'Prog1',
        pouType: 'program',
        interface: {
          variables: [
            {
              name: 'v1',
              type: { definition: 'base-type', value: 'BOOL' },
              location: '',
              documentation: '',
              debug: true,
            },
          ],
        },
        body: { language: 'st', value: '' },
      },
      {
        name: 'Prog2',
        pouType: 'program',
        interface: {
          variables: [
            {
              name: 'v2',
              type: { definition: 'base-type', value: 'INT' },
              location: '',
              documentation: '',
              debug: false,
            },
          ],
        },
        body: { language: 'st', value: '' },
      },
    ]
    const result = collectDebugVariables(globalVars, pous)
    expect(result).toEqual({ global: ['gDebug'], pous: { Prog1: ['v1'] } })
  })

  it('handles pous with no interface', () => {
    const pous: PLCPou[] = [
      {
        name: 'P1',
        pouType: 'program',
        body: { language: 'st', value: '' },
      },
    ]
    const result = collectDebugVariables([], pous)
    expect(result).toBeUndefined()
  })

  it('handles pous with undefined variables array in interface', () => {
    const pous: PLCPou[] = [
      {
        name: 'P1',
        pouType: 'program',
        interface: { variables: undefined } as unknown as PLCPou['interface'],
        body: { language: 'st', value: '' },
      },
    ]
    const result = collectDebugVariables([], pous)
    expect(result).toBeUndefined()
  })
})
