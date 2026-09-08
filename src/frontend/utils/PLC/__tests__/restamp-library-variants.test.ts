import { produce } from 'immer'

import type { SystemLibrary } from '../../../../middleware/shared/ports/library-types'
import {
  type RestampChange,
  restampFlowLibraryVariants,
  summariseRestampChanges,
} from '../restamp-library-variants'

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

type LibVar = { name: string; class: string; type: { definition: string; value: string } }

/** A system library whose ADR function now returns __XWORD (was ULINT). */
function makeSystemLibraries(overrides: Partial<Record<string, unknown>> = {}): SystemLibrary[] {
  return [
    {
      name: 'STANDARD_FUNCTIONS',
      pous: [
        {
          name: 'ADR',
          type: 'function',
          language: 'st',
          body: '',
          documentation: '',
          variables: [
            { name: 'OUT', class: 'output', type: { definition: 'base-type', value: '__XWORD' } },
            { name: 'IN', class: 'input', type: { definition: 'generic-type', value: 'ANY' } },
          ] as LibVar[],
          ...overrides,
        },
      ],
    },
  ] as unknown as SystemLibrary[]
}

/** A block node whose ADR variant is still stamped with the old ULINT return. */
function makeStaleAdrNode() {
  return {
    id: 'block-1',
    type: 'block',
    data: {
      variable: { name: 'ADR0' },
      variant: {
        name: 'ADR',
        type: 'function',
        language: 'st',
        body: '',
        documentation: '',
        variables: [
          { name: 'OUT', class: 'output', type: { definition: 'base-type', value: 'ULINT' } },
          { name: 'IN', class: 'input', type: { definition: 'generic-type', value: 'ANY' } },
        ],
      },
    },
  }
}

/** The same library, plus a MODE pin ADR does not have yet. */
function grownLibrary(): SystemLibrary[] {
  return makeSystemLibraries({
    variables: [
      { name: 'OUT', class: 'output', type: { definition: 'base-type', value: 'ULINT' } },
      { name: 'IN', class: 'input', type: { definition: 'generic-type', value: 'ANY' } },
      { name: 'MODE', class: 'input', type: { definition: 'derived-type', value: 'UIO_MODE' } },
    ],
  })
}

/** A placed block carrying the connector geometry a re-measure anchors on. */
function measurableNode() {
  const node = makeStaleAdrNode() as ReturnType<typeof makeStaleAdrNode> & {
    width?: number
    measured?: { width: number; height: number }
    data: { inputConnector?: { glbPosition: { x: number; y: number } }; handles?: unknown[] }
  }
  node.data.inputConnector = { glbPosition: { x: 10, y: 20 } }
  return node
}

const applied = (changes: RestampChange[]) => changes.filter((change) => change.applied)
const kindOf = (changes: RestampChange[], kind: string) => changes.find((change) => change.kind === kind)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('restampFlowLibraryVariants', () => {
  it('refreshes a stale library block return type (ADR ULINT -> __XWORD)', () => {
    const node = makeStaleAdrNode()
    const flow = { rung: { nodes: [node] } }

    const { changes } = restampFlowLibraryVariants([flow], makeSystemLibraries(), [])

    expect(applied(changes)).toHaveLength(1)
    expect(kindOf(changes, 'type')).toMatchObject({ block: 'ADR', pin: 'OUT', from: 'ULINT', to: '__XWORD' })
    expect(node.data.variant.variables.find((v) => v.name === 'OUT')!.type.value).toBe('__XWORD')
  })

  it('walks every rung of a ladder flow', () => {
    const node = makeStaleAdrNode()
    const flow = { rungs: [{ nodes: [] }, { nodes: [node] }] }

    const { changes } = restampFlowLibraryVariants([flow], makeSystemLibraries(), [])

    expect(applied(changes)).toHaveLength(1)
    expect(node.data.variant.variables[0].type.value).toBe('__XWORD')
  })

  it('skips blocks backed by a user-defined POU', () => {
    const node = makeStaleAdrNode()
    const flow = { rung: { nodes: [node] } }

    const { changes } = restampFlowLibraryVariants([flow], makeSystemLibraries(), ['ADR'])

    expect(changes).toHaveLength(0)
    expect(node.data.variant.variables[0].type.value).toBe('ULINT')
  })

  it('leaves up-to-date variants untouched (no spurious changes)', () => {
    const node = makeStaleAdrNode()
    node.data.variant.variables[0].type.value = '__XWORD'
    const flow = { rung: { nodes: [node] } }

    expect(restampFlowLibraryVariants([flow], makeSystemLibraries(), []).changes).toHaveLength(0)
  })

  it('ignores blocks not present in any library (user blocks, unknown types)', () => {
    const node = makeStaleAdrNode()
    node.data.variant.name = 'MY_CUSTOM_FB'
    const flow = { rung: { nodes: [node] } }

    expect(restampFlowLibraryVariants([flow], makeSystemLibraries(), []).changes).toHaveLength(0)
    expect(node.data.variant.variables[0].type.value).toBe('ULINT')
  })

  it('reports an empty pool rather than a clean project', () => {
    const node = makeStaleAdrNode()
    const flow = { rung: { nodes: [node] } }

    const report = restampFlowLibraryVariants([flow], [], [])

    expect(report.poolEmpty).toBe(true)
    expect(report.changes).toHaveLength(0)
    expect(node.data.variant.variables[0].type.value).toBe('ULINT')
  })

  it('refreshes stale documentation', () => {
    const node = makeStaleAdrNode()
    node.data.variant.documentation = 'the old wording'
    const libraries = makeSystemLibraries({ documentation: 'the new wording' })

    const { changes } = restampFlowLibraryVariants([{ rung: { nodes: [node] } }], libraries, [])

    expect(kindOf(changes, 'documentation')).toMatchObject({ severity: 'info', applied: true })
    expect(node.data.variant.documentation).toBe('the new wording')
  })

  it('refreshes extensible, but only reports a change of block kind', () => {
    const node = makeStaleAdrNode()
    const libraries = makeSystemLibraries({ extensible: true, type: 'function-block' })

    const { changes } = restampFlowLibraryVariants([{ rung: { nodes: [node] } }], libraries, [])

    expect(kindOf(changes, 'extensible')).toMatchObject({ from: 'false', to: 'true', applied: true })
    // Applying it would leave a function block with no instance variable.
    expect(kindOf(changes, 'block-type')).toMatchObject({
      from: 'function',
      to: 'function-block',
      applied: false,
      severity: 'error',
    })
    expect(node.data.variant.type).toBe('function')
  })

  it('leaves an extensible block\'s extra pins alone', () => {
    const node = makeStaleAdrNode()
    node.data.variant.variables.push({ name: 'IN2', class: 'input', type: { definition: 'generic-type', value: 'ANY' } })
    const libraries = makeSystemLibraries({ extensible: true })

    const { changes } = restampFlowLibraryVariants([{ rung: { nodes: [node] } }], libraries, [])

    // IN2 is the diagram's, not the library's: a variadic block grows past its
    // declared parameters.
    expect(kindOf(changes, 'pin-removed')).toBeUndefined()
    expect(node.data.variant.variables.map((v) => v.name)).toContain('IN2')
  })

  it('applies a class change that keeps the pin on the same side', () => {
    const node = makeStaleAdrNode()
    const libraries = makeSystemLibraries({
      variables: [
        { name: 'OUT', class: 'output', type: { definition: 'base-type', value: 'ULINT' } },
        { name: 'IN', class: 'inOut', type: { definition: 'generic-type', value: 'ANY' } },
      ],
    })

    const { changes } = restampFlowLibraryVariants([{ rung: { nodes: [node] } }], libraries, [])

    expect(kindOf(changes, 'class')).toMatchObject({ pin: 'IN', from: 'input', to: 'inOut', applied: true })
    expect(node.data.variant.variables[1].class).toBe('inOut')
  })

  it('reports without applying a class change that moves the pin to the other side', () => {
    const node = makeStaleAdrNode()
    const libraries = makeSystemLibraries({
      variables: [
        { name: 'OUT', class: 'output', type: { definition: 'base-type', value: 'ULINT' } },
        { name: 'IN', class: 'output', type: { definition: 'generic-type', value: 'ANY' } },
      ],
    })

    const { changes } = restampFlowLibraryVariants([{ rung: { nodes: [node] } }], libraries, [])

    expect(kindOf(changes, 'pin-side')).toMatchObject({ pin: 'IN', applied: false, severity: 'warning' })
    expect(node.data.variant.variables[1].class).toBe('input')
  })

  it('reports a removed pin as an error when something is wired to it', () => {
    const node = makeStaleAdrNode()
    const libraries = makeSystemLibraries({
      variables: [{ name: 'OUT', class: 'output', type: { definition: 'base-type', value: 'ULINT' } }],
    })
    const flow = {
      rung: {
        nodes: [node],
        edges: [{ source: 'var-1', target: 'block-1', sourceHandle: 'out', targetHandle: 'IN' }],
      },
    }

    const { changes } = restampFlowLibraryVariants([flow], libraries, [])

    expect(kindOf(changes, 'pin-removed')).toMatchObject({
      pin: 'IN',
      severity: 'error',
      applied: false,
      connected: true,
    })
    // Not applied: the pin stays until the node's handles can be rebuilt.
    expect(node.data.variant.variables).toHaveLength(2)
  })

  it('reports a removed pin as a warning when nothing is wired to it', () => {
    const node = makeStaleAdrNode()
    const libraries = makeSystemLibraries({
      variables: [{ name: 'OUT', class: 'output', type: { definition: 'base-type', value: 'ULINT' } }],
    })

    const { changes } = restampFlowLibraryVariants([{ rung: { nodes: [node] } }], libraries, [])

    expect(kindOf(changes, 'pin-removed')).toMatchObject({ pin: 'IN', severity: 'warning', connected: false })
  })

  it('treats a variable bound to a handle as a connection', () => {
    const node = makeStaleAdrNode() as ReturnType<typeof makeStaleAdrNode> & {
      data: { connectedVariables?: Array<{ handleId: string }> }
    }
    node.data.connectedVariables = [{ handleId: 'OUT' }]

    const { changes } = restampFlowLibraryVariants([{ rung: { nodes: [node] } }], makeSystemLibraries(), [])

    expect(kindOf(changes, 'type')).toMatchObject({ severity: 'warning', connected: true })
  })

  it('reports a pin the library added, and leaves the block alone without a measurer', () => {
    const node = makeStaleAdrNode()

    const { changes } = restampFlowLibraryVariants([{ rung: { nodes: [node] } }], grownLibrary(), [])

    expect(kindOf(changes, 'pin-added')).toMatchObject({ pin: 'MODE', to: 'UIO_MODE', applied: false })
    expect(node.data.variant.variables.map((v) => v.name)).toEqual(['OUT', 'IN'])
  })

  it('grows the block onto an added pin when a measurer is supplied', () => {
    const node = measurableNode()
    const measureBlock = jest.fn(() => ({
      handles: ['h'],
      leftHandles: [{ glbPosition: { x: 5, y: 6 } }],
      rightHandles: [{ glbPosition: { x: 9, y: 6 } }],
      width: 120,
      height: 80,
    }))

    const { changes } = restampFlowLibraryVariants([{ rung: { nodes: [node] } }], grownLibrary(), [], {
      measureBlock,
    })

    expect(kindOf(changes, 'pin-added')).toMatchObject({ pin: 'MODE', applied: true, severity: 'info' })
    expect(node.data.variant.variables.map((v) => v.name)).toEqual(['OUT', 'IN', 'MODE'])
    // Measured from the connector the block already had, so it does not move.
    expect(measureBlock).toHaveBeenCalledWith(node.data.variant, { x: 10, y: 20 })
    expect(node.data.handles).toEqual(['h'])
    expect(node.data.inputConnector).toEqual({ glbPosition: { x: 5, y: 6 } })
    expect(node.width).toBe(120)
    expect(node.measured).toEqual({ width: 120, height: 80 })
  })

  it('does not grow a block that has no connector to measure from', () => {
    const node = makeStaleAdrNode()
    const measureBlock = jest.fn()

    const { changes } = restampFlowLibraryVariants([{ rung: { nodes: [node] } }], grownLibrary(), [], {
      measureBlock,
    })

    expect(measureBlock).not.toHaveBeenCalled()
    expect(kindOf(changes, 'pin-added')).toMatchObject({ applied: false })
    expect(node.data.variant.variables.map((v) => v.name)).toEqual(['OUT', 'IN'])
  })

  it('ignores the implicit EN/ENO pins', () => {
    const node = makeStaleAdrNode()
    node.data.variant.variables.push(
      { name: 'EN', class: 'input', type: { definition: 'generic-type', value: 'BOOL' } },
      { name: 'ENO', class: 'output', type: { definition: 'generic-type', value: 'BOOL' } },
    )

    const { changes } = restampFlowLibraryVariants([{ rung: { nodes: [node] } }], makeSystemLibraries(), [])

    expect(changes.filter((change) => change.pin === 'EN' || change.pin === 'ENO')).toHaveLength(0)
  })

  it('mutates in place, so a caller holding store state must clone first', () => {
    // The store's flows come back from immer frozen. This is the contract the
    // library-update action relies on: re-stamp a copy, then hand it back.
    const frozen = produce({ rung: { nodes: [makeStaleAdrNode()] } }, () => {})

    expect(() => restampFlowLibraryVariants([frozen as never], makeSystemLibraries(), [])).toThrow()

    const clone = structuredClone(frozen) as unknown as { rung: { nodes: unknown[] } }
    expect(() => restampFlowLibraryVariants([clone as never], makeSystemLibraries(), [])).not.toThrow()
  })

  it('brings a variable wired to a pin along with the pin', () => {
    // A variable node keeps its own copy of the pin signature. The canvas
    // renders its type as the `(*TYPE*)` placeholder and validates dropped
    // variables against it, so a stale copy makes the update look like it did
    // nothing.
    const block = makeStaleAdrNode()
    const attached = {
      id: 'var-node-1',
      type: 'variable',
      data: {
        variant: 'output',
        variable: { name: '' },
        block: {
          id: block.id,
          handleId: 'OUT',
          variableType: { name: 'OUT', class: 'output', type: { definition: 'base-type', value: 'ULINT' } },
        },
      },
    }

    restampFlowLibraryVariants([{ rung: { nodes: [block, attached] } }], makeSystemLibraries(), [])

    expect(block.data.variant.variables.find((v) => v.name === 'OUT')!.type.value).toBe('__XWORD')
    expect(attached.data.block.variableType.type.value).toBe('__XWORD')
  })

  it('reports the flow as modified when only the wired copy was stale', () => {
    // The block itself is current; only the variable's copy of the pin is
    // behind. Without `modified` the correction is made in memory, never
    // persisted, and redone on every load.
    const block = makeStaleAdrNode()
    block.data.variant.variables[0].type.value = '__XWORD'
    const attached = {
      id: 'var-node-1',
      type: 'variable',
      data: {
        variant: 'output',
        variable: { name: '' },
        block: {
          id: block.id,
          handleId: 'OUT',
          variableType: { name: 'OUT', class: 'output', type: { definition: 'base-type', value: 'ULINT' } },
        },
      },
    }

    const report = restampFlowLibraryVariants([{ rung: { nodes: [block, attached] } }], makeSystemLibraries(), [])

    expect(report.changes).toHaveLength(0)
    expect(report.modified).toBe(true)
    expect(attached.data.block.variableType.type.value).toBe('__XWORD')
  })

  it('reports nothing modified when everything already agrees', () => {
    const block = makeStaleAdrNode()
    block.data.variant.variables[0].type.value = '__XWORD'

    const report = restampFlowLibraryVariants([{ rung: { nodes: [block] } }], makeSystemLibraries(), [])

    expect(report.changes).toHaveLength(0)
    expect(report.modified).toBe(false)
  })

  it('leaves a variable wired to a different block alone', () => {
    const block = makeStaleAdrNode()
    const attached = {
      id: 'var-node-1',
      type: 'variable',
      data: {
        variant: 'output',
        variable: { name: '' },
        block: {
          id: 'SOME_OTHER_BLOCK',
          handleId: 'OUT',
          variableType: { name: 'OUT', class: 'output', type: { definition: 'base-type', value: 'ULINT' } },
        },
      },
    }

    restampFlowLibraryVariants([{ rung: { nodes: [block, attached] } }], makeSystemLibraries(), [])

    expect(attached.data.block.variableType.type.value).toBe('ULINT')
  })

  it('stamps the POU name onto every change when given one', () => {
    const node = makeStaleAdrNode()

    const { changes } = restampFlowLibraryVariants([{ rung: { nodes: [node] } }], makeSystemLibraries(), [], { pou: 'main' })

    expect(changes.every((change) => change.pou === 'main')).toBe(true)
  })
})

describe('FBD flows', () => {
  // FBD keeps no copy of a pin: `fbd/variable.tsx` finds the connected block
  // and reads `data.variant.variables` live, matching on the edge's handle,
  // and builds its `(*TYPE*)` label from that. So refreshing the variant is
  // the whole job -- unlike LD, which caches the pin on the variable node.
  const fbdPinTypeAsTheEditorResolvesIt = (
    rung: { nodes: { id: string; type?: string; data?: never }[]; edges: { source: string; target: string; sourceHandle?: string; targetHandle?: string }[] },
    variableNodeId: string,
  ): string | undefined => {
    const edge = rung.edges.find((e) => e.source === variableNodeId || e.target === variableNodeId)!
    const other = edge.source === variableNodeId ? edge.target : edge.source
    const block = rung.nodes.find((n) => n.id === other && n.type === 'block')!
    const variables = (block.data as never as { variant: { variables: { name: string; type: { value: string } }[] } })
      .variant.variables
    return variables.find((v) => v.name === edge.sourceHandle || v.name === edge.targetHandle)?.type.value
  }

  it('updates what the editor resolves for a wired pin, with no cached copy to chase', () => {
    const block = makeStaleAdrNode()
    const wired = { id: 'VAR_out', type: 'output-variable', data: { variant: 'output-variable', variable: { name: 'X' } } }
    const rung = {
      nodes: [block, wired],
      edges: [{ id: 'e1', source: block.id, target: 'VAR_out', sourceHandle: 'OUT', targetHandle: 'input-variable' }],
    }

    expect(fbdPinTypeAsTheEditorResolvesIt(rung as never, 'VAR_out')).toBe('ULINT')

    const report = restampFlowLibraryVariants([{ rung } as never], makeSystemLibraries(), [])

    expect(report.modified).toBe(true)
    expect(fbdPinTypeAsTheEditorResolvesIt(rung as never, 'VAR_out')).toBe('__XWORD')
    // An FBD variable node has no `data.block`, so the second pass must simply
    // leave it alone rather than trip over the missing field.
    expect(wired.data).not.toHaveProperty('block')
  })

  it('walks an FBD flow that carries edges', () => {
    const block = makeStaleAdrNode()
    const flow = { rung: { nodes: [block], edges: [{ id: 'e', source: 'x', target: block.id, targetHandle: 'IN' }] } }

    expect(restampFlowLibraryVariants([flow as never], makeSystemLibraries(), []).modified).toBe(true)
  })
})

describe('pin type transitions', () => {
  type Def = 'base-type' | 'generic-type' | 'derived-type'

  const libWithPin = (definition: Def, value: string): SystemLibrary[] =>
    [
      {
        name: 'L',
        pous: [
          {
            name: 'FB',
            type: 'function-block',
            language: 'st',
            body: '',
            documentation: 'doc',
            variables: [{ name: 'P', class: 'input', type: { definition, value } }],
          },
        ],
      },
    ] as unknown as SystemLibrary[]

  const placed = (definition: Def, value: string) => {
    const block = {
      id: 'b1',
      type: 'block',
      data: {
        variable: { name: 'FB0' },
        variant: {
          name: 'FB',
          type: 'function-block',
          documentation: 'doc',
          variables: [{ name: 'P', class: 'input', type: { definition, value } }],
        },
      },
    }
    const wired = {
      id: 'v1',
      type: 'variable',
      data: {
        variant: 'input',
        variable: { name: '' },
        block: { id: 'b1', handleId: 'P', variableType: { name: 'P', class: 'input', type: { definition, value } } },
      },
    }
    return { block, wired }
  }

  // Every definition pairing, plus the exotic values the real libraries use:
  // an FB type passed by reference (NODE), a platform-width word, and a sized
  // string — which `typeRef` classifies as derived because it is not a bare
  // base-type name.
  const cases: Array<[string, Def, string, Def, string]> = [
    ['base to base', 'base-type', 'INT', 'base-type', 'REAL'],
    ['base to base (bit widths)', 'base-type', 'BYTE', 'base-type', 'DWORD'],
    ['base to base (time)', 'base-type', 'TIME', 'base-type', 'DT'],
    ['base to base (strings)', 'base-type', 'STRING', 'base-type', 'WSTRING'],
    ['base to platform word', 'base-type', 'ULINT', 'base-type', '__XWORD'],
    ['base to generic', 'base-type', 'INT', 'generic-type', 'ANY_NUM'],
    ['generic to base', 'generic-type', 'ANY', 'base-type', 'BOOL'],
    ['generic to generic', 'generic-type', 'ANY', 'generic-type', 'ANY_INT'],
    ['base to derived enum', 'base-type', 'INT', 'derived-type', 'UIO_MODE'],
    ['derived to derived enum', 'derived-type', 'UIO_MODE', 'derived-type', 'UIO_RESULT'],
    ['derived to base', 'derived-type', 'MODBEE_RESULT', 'base-type', 'INT'],
    ['derived FB reference', 'derived-type', 'NODE', 'derived-type', 'NODE_LINK'],
    ['base to sized string', 'base-type', 'STRING', 'derived-type', 'STRING(23)'],
  ]

  it.each(cases)('%s: %s %s -> %s %s', (_label, fromDef, fromValue, toDef, toValue) => {
    const { block, wired } = placed(fromDef, fromValue)

    const report = restampFlowLibraryVariants(
      [{ rung: { nodes: [block, wired] } }],
      libWithPin(toDef, toValue),
      [],
      { pou: 'main' },
    )

    expect(report.modified).toBe(true)
    expect(kindOf(report.changes, 'type')).toMatchObject({ pin: 'P', from: fromValue, to: toValue, applied: true })
    // The pin, and the copy held by the variable wired to it.
    expect(block.data.variant.variables[0].type).toEqual({ definition: toDef, value: toValue })
    expect(wired.data.block.variableType.type).toEqual({ definition: toDef, value: toValue })
  })

  it('reports nothing when the definition and value both already match', () => {
    const { block, wired } = placed('derived-type', 'UIO_MODE')

    const report = restampFlowLibraryVariants(
      [{ rung: { nodes: [block, wired] } }],
      libWithPin('derived-type', 'UIO_MODE'),
      [],
    )

    expect(report.changes).toHaveLength(0)
    expect(report.modified).toBe(false)
  })

  it('notices a definition change even when the value is unchanged', () => {
    // STRING as a base type and STRING as a library-declared alias are not the
    // same pin, and a value-only compare would miss it.
    const { block, wired } = placed('base-type', 'STRING')

    const report = restampFlowLibraryVariants(
      [{ rung: { nodes: [block, wired] } }],
      libWithPin('derived-type', 'STRING'),
      [],
    )

    expect(report.modified).toBe(true)
    expect(block.data.variant.variables[0].type.definition).toBe('derived-type')
    expect(wired.data.block.variableType.type.definition).toBe('derived-type')
  })
})

describe('summariseRestampChanges', () => {
  it('collapses the same change across many placed blocks into one line', () => {
    const change: RestampChange = {
      block: 'ANALOG_IN',
      pou: 'main',
      pin: 'AI01',
      kind: 'type',
      from: 'INT',
      to: 'REAL',
      severity: 'info',
      applied: true,
    }

    const lines = summariseRestampChanges([change, { ...change }, { ...change }])

    expect(lines).toHaveLength(1)
    expect(lines[0].message).toBe('ANALOG_IN.AI01: type INT → REAL — 3 blocks in main.')
  })

  it('orders errors before warnings before info', () => {
    const base = { block: 'B', kind: 'documentation' as const, applied: true }
    const lines = summariseRestampChanges([
      { ...base, severity: 'info' },
      { ...base, block: 'A', severity: 'error' },
      { ...base, block: 'C', severity: 'warning' },
    ])

    expect(lines.map((line) => line.severity)).toEqual(['error', 'warning', 'info'])
  })
})
