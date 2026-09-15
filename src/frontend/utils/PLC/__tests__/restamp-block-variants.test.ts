import type { PLCVariable } from '../../../../middleware/shared/ports/types'
import type { SystemLibrary } from '../../../../middleware/shared/ports/library-types'
import { syncNodesWithVariables } from '../../graphical/sync-nodes-with-variables'
import { restampFlowBlockVariants } from '../restamp-block-variants'

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/** A system library whose ADR function now returns __XWORD (was ULINT). */
function makeSystemLibraries(): SystemLibrary[] {
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
          ],
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

/** A project function block whose IN1 pin is typed MyStruct. */
function makeUserPou(
  name: string,
  variables: Array<{ name: string; class: string; definition: string; value: string }>,
  options: { pouType?: string; returnType?: string } = {},
) {
  return {
    name,
    pouType: options.pouType ?? 'function-block',
    body: { language: 'st', value: '' },
    interface: {
      ...(options.returnType ? { returnType: options.returnType } : {}),
      variables: variables.map((variable) => ({
        name: variable.name,
        class: variable.class,
        type: { definition: variable.definition, value: variable.value },
      })),
    },
  } as unknown as Parameters<typeof restampFlowBlockVariants>[2][number]
}

/** A placed user FB whose IN1 pin is still stamped with the old type. */
function makeStaleUserBlockNode(pinValue = 'OLDSTRUCT') {
  return {
    id: 'block-1',
    type: 'block',
    data: {
      variant: {
        name: 'MyFB',
        type: 'function-block',
        variables: [{ name: 'IN1', class: 'input', type: { definition: 'user-data-type', value: pinValue } }],
      },
    },
  }
}

/** The ladder pin node that connects a variable to that block's IN1 pin. */
function makePinNode(pinValue = 'OLDSTRUCT') {
  return {
    id: 'pin-1',
    type: 'variable',
    data: {
      variable: { name: 'motor' },
      variant: 'input',
      block: {
        id: 'block-1',
        handleId: 'IN1',
        variableType: { name: 'IN1', class: 'input', type: { definition: 'user-data-type', value: pinValue } },
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('restampFlowBlockVariants', () => {
  it('refreshes a stale library block return type (ADR ULINT -> __XWORD)', () => {
    const node = makeStaleAdrNode()
    const flow = { rung: { nodes: [node] } }

    const changed = restampFlowBlockVariants([flow], makeSystemLibraries(), [])

    expect(changed).toBe(1)
    expect(node.data.variant.variables.find((v) => v.name === 'OUT')!.type.value).toBe('__XWORD')
  })

  it('walks every rung of a ladder flow', () => {
    const node = makeStaleAdrNode()
    const flow = { rungs: [{ nodes: [] }, { nodes: [node] }] }

    const changed = restampFlowBlockVariants([flow], makeSystemLibraries(), [])

    expect(changed).toBe(1)
    expect(node.data.variant.variables[0].type.value).toBe('__XWORD')
  })

  it('lets a user-defined POU win over a library entry of the same name', () => {
    // A user POU named "ADR" (contrived): the project owns its own interface,
    // so its return type is stamped, not the library's __XWORD.
    const node = makeStaleAdrNode()
    const flow = { rung: { nodes: [node] } }

    const changed = restampFlowBlockVariants([flow], makeSystemLibraries(), [
      makeUserPou('ADR', [], { pouType: 'function', returnType: 'DINT' }),
    ])

    expect(changed).toBe(1)
    expect(node.data.variant.variables[0].type.value).toBe('DINT')
  })

  it('leaves up-to-date variants untouched (no spurious changes)', () => {
    const node = makeStaleAdrNode()
    node.data.variant.variables[0].type.value = '__XWORD'
    const flow = { rung: { nodes: [node] } }

    const changed = restampFlowBlockVariants([flow], makeSystemLibraries(), [])

    expect(changed).toBe(0)
  })

  it('ignores blocks not present in any library (user blocks, unknown types)', () => {
    const node = makeStaleAdrNode()
    node.data.variant.name = 'MY_CUSTOM_FB'
    const flow = { rung: { nodes: [node] } }

    const changed = restampFlowBlockVariants([flow], makeSystemLibraries(), [])

    expect(changed).toBe(0)
    expect(node.data.variant.variables[0].type.value).toBe('ULINT')
  })

  it('is a no-op when neither a library nor a project POU defines the block', () => {
    const node = makeStaleAdrNode()
    const flow = { rung: { nodes: [node] } }

    const changed = restampFlowBlockVariants([flow], [], [])

    expect(changed).toBe(0)
    expect(node.data.variant.variables[0].type.value).toBe('ULINT')
  })
})

describe('restampFlowBlockVariants — blocks backed by a project POU', () => {
  it('refreshes a stale user function-block pin type from the POU interface', () => {
    const node = makeStaleUserBlockNode()
    const flow = { rung: { nodes: [node] } }

    const changed = restampFlowBlockVariants(
      [flow],
      [],
      [makeUserPou('MyFB', [{ name: 'IN1', class: 'input', definition: 'user-data-type', value: 'MyStruct' }])],
    )

    expect(changed).toBe(1)
    expect(node.data.variant.variables[0].type).toEqual({ definition: 'user-data-type', value: 'MYSTRUCT' })
  })

  it("follows the POU's return type for a function's OUT pin", () => {
    const node = makeStaleUserBlockNode()
    node.data.variant.name = 'MyFn'
    node.data.variant.type = 'function'
    node.data.variant.variables = [
      { name: 'OUT', class: 'output', type: { definition: 'base-type', value: 'INT' } },
    ] as unknown as typeof node.data.variant.variables
    const flow = { rung: { nodes: [node] } }

    const changed = restampFlowBlockVariants(
      [flow],
      [],
      [makeUserPou('MyFn', [], { pouType: 'function', returnType: 'REAL' })],
    )

    expect(changed).toBe(1)
    expect(node.data.variant.variables[0].type.value).toBe('REAL')
  })

  it('leaves pins the interface no longer declares alone (EN/ENO, removed pins)', () => {
    const node = makeStaleUserBlockNode()
    node.data.variant.variables = [
      { name: 'EN', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
      { name: 'GONE', class: 'input', type: { definition: 'base-type', value: 'INT' } },
    ] as unknown as typeof node.data.variant.variables
    const flow = { rung: { nodes: [node] } }

    const changed = restampFlowBlockVariants(
      [flow],
      [],
      [makeUserPou('MyFB', [{ name: 'IN1', class: 'input', definition: 'base-type', value: 'REAL' }])],
    )

    expect(changed).toBe(0)
    expect(node.data.variant.variables.map((variable) => variable.name)).toEqual(['EN', 'GONE'])
  })

  it('never adds a pin the interface gained (that needs the node rebuilt)', () => {
    const node = makeStaleUserBlockNode()
    const flow = { rung: { nodes: [node] } }

    restampFlowBlockVariants(
      [flow],
      [],
      [
        makeUserPou('MyFB', [
          { name: 'IN1', class: 'input', definition: 'user-data-type', value: 'MyStruct' },
          { name: 'IN2', class: 'input', definition: 'base-type', value: 'INT' },
        ]),
      ],
    )

    expect(node.data.variant.variables).toHaveLength(1)
  })

  it('matches the POU name case-insensitively, as IEC identifiers are', () => {
    const node = makeStaleUserBlockNode()
    const flow = { rung: { nodes: [node] } }

    const changed = restampFlowBlockVariants(
      [flow],
      [],
      [makeUserPou('myfb', [{ name: 'in1', class: 'input', definition: 'user-data-type', value: 'MyStruct' }])],
    )

    expect(changed).toBe(1)
    expect(node.data.variant.variables[0].type.value).toBe('MYSTRUCT')
  })

  it('leaves an up-to-date user block untouched', () => {
    const node = makeStaleUserBlockNode('MYSTRUCT')
    const flow = { rung: { nodes: [node] } }

    const changed = restampFlowBlockVariants(
      [flow],
      [],
      [makeUserPou('MyFB', [{ name: 'IN1', class: 'input', definition: 'user-data-type', value: 'MyStruct' }])],
    )

    expect(changed).toBe(0)
  })
})

describe('restampFlowBlockVariants — ladder pin nodes', () => {
  it("refreshes the pin node's cached type from the block it connects to", () => {
    const pinNode = makePinNode()
    const flow = { rung: { nodes: [makeStaleUserBlockNode(), pinNode] } }

    restampFlowBlockVariants(
      [flow],
      [],
      [makeUserPou('MyFB', [{ name: 'IN1', class: 'input', definition: 'user-data-type', value: 'MyStruct' }])],
    )

    expect(pinNode.data.block.variableType.type).toEqual({ definition: 'user-data-type', value: 'MYSTRUCT' })
  })

  it('refreshes a pin node whose block is a library block', () => {
    const blockNode = makeStaleAdrNode()
    const pinNode = makePinNode('ULINT')
    pinNode.data.block.handleId = 'OUT'
    pinNode.data.block.variableType = {
      name: 'OUT',
      class: 'output',
      type: { definition: 'base-type', value: 'ULINT' },
    } as unknown as typeof pinNode.data.block.variableType
    const flow = { rung: { nodes: [blockNode, pinNode] } }

    restampFlowBlockVariants([flow], makeSystemLibraries(), [])

    expect(pinNode.data.block.variableType.type.value).toBe('__XWORD')
  })

  it('leaves a pin node whose block is not in the rung alone', () => {
    const pinNode = makePinNode()
    const flow = { rung: { nodes: [pinNode] } }

    const changed = restampFlowBlockVariants(
      [flow],
      [],
      [makeUserPou('MyFB', [{ name: 'IN1', class: 'input', definition: 'user-data-type', value: 'MyStruct' }])],
    )

    expect(changed).toBe(0)
    expect(pinNode.data.block.variableType.type.value).toBe('OLDSTRUCT')
  })
})

describe('DOPE-548 — a user FB pin type change must not break a linked variable', () => {
  it('leaves the link intact once the block and its pin node are re-stamped', () => {
    const flow = {
      name: 'Prog',
      rungs: [{ id: 'r1', nodes: [makeStaleUserBlockNode(), makePinNode()], edges: [] }],
    }
    // The FB now declares IN1 : MyStruct, and the POU variable follows it.
    const userPous = [
      makeUserPou('MyFB', [{ name: 'IN1', class: 'input', definition: 'user-data-type', value: 'MyStruct' }]),
    ]
    const variables = [
      { id: '1', name: 'motor', type: { definition: 'user-data-type', value: 'MYSTRUCT' } },
    ] as unknown as PLCVariable[]

    restampFlowBlockVariants([flow], [], userPous)

    const updateNodes = vi.fn()
    syncNodesWithVariables(variables, [flow] as unknown as Parameters<typeof syncNodesWithVariables>[1], updateNodes)

    // Without the re-stamp the pin still reads OLDSTRUCT and the node is
    // replaced by a broken-… payload flagged wrongVariable.
    expect(updateNodes).not.toHaveBeenCalled()
  })
})
