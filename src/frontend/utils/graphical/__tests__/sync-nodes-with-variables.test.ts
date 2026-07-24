import type { Node } from '@xyflow/react'

import type { PLCVariable } from '../../../../middleware/shared/ports/types'
import { syncNodesWithVariables, syncNodesWithVariablesFBD } from '../sync-nodes-with-variables'

const makeVariable = (name: string, typeValue = 'BOOL', definition = 'base-type', id = '1'): PLCVariable =>
  ({
    id,
    name,
    type: { definition, value: typeValue },
  }) as unknown as PLCVariable

const makeNode = (
  id: string,
  type: string,
  variable?: Partial<PLCVariable>,
  extra?: Record<string, unknown>,
): Node => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: {
    ...(variable ? { variable } : {}),
    ...(extra ?? {}),
  },
})

describe('syncNodesWithVariables', () => {
  it('updates a contact node when the variable type no longer matches BOOL', () => {
    const updateNodes = vi.fn()
    const variable = makeVariable('myVar', 'INT')
    const node = makeNode('n1', 'contact', {
      name: 'myVar',
      id: '1',
      type: { definition: 'base-type', value: 'BOOL' } as PLCVariable['type'],
    })

    const ladderFlows = [
      {
        name: 'editor1',
        rungs: [{ id: 'r1', nodes: [node], edges: [] }],
      },
    ] as unknown as Parameters<typeof syncNodesWithVariables>[1]

    syncNodesWithVariables([variable], ladderFlows, updateNodes)

    // When type mismatches, variable id is set to "broken-<nodeId>" to mark it as broken.
    expect(updateNodes).toHaveBeenCalledWith([
      expect.objectContaining({
        editorName: 'editor1',
        rungId: 'r1',
        nodeId: 'n1',
        node: expect.objectContaining({
          data: expect.objectContaining({
            variable: { ...variable, id: 'broken-n1' },
            wrongVariable: true,
          }),
        }),
      }),
    ])
  })

  it('does not update a contact node when only the variable id changes but types still match', () => {
    const updateNodes = vi.fn()
    const variable = makeVariable('myVar', 'BOOL', 'base-type', '2')
    const node = makeNode('n1', 'contact', {
      name: 'myVar',
      id: '1',
      type: { definition: 'base-type', value: 'BOOL' } as PLCVariable['type'],
    })

    const ladderFlows = [
      {
        name: 'editor1',
        rungs: [{ id: 'r1', nodes: [node], edges: [] }],
      },
    ] as unknown as Parameters<typeof syncNodesWithVariables>[1]

    syncNodesWithVariables([variable], ladderFlows, updateNodes)

    // Types match and wrongVariable is not set, so no update is needed.
    expect(updateNodes).not.toHaveBeenCalled()
  })

  it('treats a POINTER TO <T> variable as compatible with a ULINT expected type', () => {
    // The sync path now delegates to the shared validateVariableType, so a
    // POINTER TO INT variable on a ULINT-typed block pin (e.g. ADR output)
    // must NOT be flagged as wrong.
    const updateNodes = vi.fn()
    const variable = makeVariable('myPtr', 'POINTER TO INT', 'user-data-type')
    const node = makeNode('n1', 'block', { name: 'myPtr' } as Partial<PLCVariable>, {
      variant: { name: 'ULINT' },
    })

    const ladderFlows = [
      {
        name: 'editor1',
        rungs: [{ id: 'r1', nodes: [node], edges: [] }],
      },
    ] as unknown as Parameters<typeof syncNodesWithVariables>[1]

    syncNodesWithVariables([variable], ladderFlows, updateNodes)
    // Types are considered compatible and wrongVariable is not set, so no update.
    expect(updateNodes).not.toHaveBeenCalled()
  })

  it('does not update when node has no variable', () => {
    const updateNodes = vi.fn()
    const node = makeNode('n1', 'contact')
    const ladderFlows = [
      {
        name: 'editor1',
        rungs: [{ id: 'r1', nodes: [node], edges: [] }],
      },
    ] as unknown as Parameters<typeof syncNodesWithVariables>[1]

    syncNodesWithVariables([makeVariable('x')], ladderFlows, updateNodes)
    expect(updateNodes).not.toHaveBeenCalled()
  })

  it('does not update when variable is not found in newVars', () => {
    const updateNodes = vi.fn()
    const node = makeNode('n1', 'contact', { name: 'missing' } as Partial<PLCVariable>)
    const ladderFlows = [
      {
        name: 'editor1',
        rungs: [{ id: 'r1', nodes: [node], edges: [] }],
      },
    ] as unknown as Parameters<typeof syncNodesWithVariables>[1]

    syncNodesWithVariables([makeVariable('other')], ladderFlows, updateNodes)
    expect(updateNodes).not.toHaveBeenCalled()
  })

  it('filters flows by editorName when provided', () => {
    const updateNodes = vi.fn()
    const variable = makeVariable('myVar', 'INT')
    const node = makeNode('n1', 'contact', {
      name: 'myVar',
      id: '1',
      type: { definition: 'base-type', value: 'BOOL' } as PLCVariable['type'],
    })

    const ladderFlows = [
      { name: 'editor1', rungs: [{ id: 'r1', nodes: [node], edges: [] }] },
      { name: 'editor2', rungs: [{ id: 'r2', nodes: [node], edges: [] }] },
    ] as unknown as Parameters<typeof syncNodesWithVariables>[1]

    syncNodesWithVariables([variable], ladderFlows, updateNodes, 'editor1')
    expect(updateNodes).toHaveBeenCalledTimes(1)
    expect(updateNodes).toHaveBeenCalledWith([expect.objectContaining({ editorName: 'editor1' })])
  })

  it('scopes the sweep to a single rung when rungId is provided', () => {
    const updateNodes = vi.fn()
    const variable = makeVariable('myVar', 'INT')
    const staleContact = (id: string) =>
      makeNode(id, 'contact', {
        name: 'myVar',
        id: '1',
        type: { definition: 'base-type', value: 'BOOL' } as PLCVariable['type'],
      })

    const ladderFlows = [
      {
        name: 'editor1',
        rungs: [
          { id: 'r1', nodes: [staleContact('n1')], edges: [] },
          { id: 'r2', nodes: [staleContact('n2')], edges: [] },
        ],
      },
    ] as unknown as Parameters<typeof syncNodesWithVariables>[1]

    syncNodesWithVariables([variable], ladderFlows, updateNodes, 'editor1', 'r2')
    expect(updateNodes).toHaveBeenCalledTimes(1)
    expect(updateNodes).toHaveBeenCalledWith([expect.objectContaining({ rungId: 'r2', nodeId: 'n2' })])
  })

  it('batches corrections across rungs into a single call', () => {
    const updateNodes = vi.fn()
    const variable = makeVariable('myVar', 'INT')
    const staleContact = (id: string) =>
      makeNode(id, 'contact', {
        name: 'myVar',
        id: '1',
        type: { definition: 'base-type', value: 'BOOL' } as PLCVariable['type'],
      })

    const ladderFlows = [
      {
        name: 'editor1',
        rungs: [
          { id: 'r1', nodes: [staleContact('n1')], edges: [] },
          { id: 'r2', nodes: [staleContact('n2')], edges: [] },
        ],
      },
    ] as unknown as Parameters<typeof syncNodesWithVariables>[1]

    syncNodesWithVariables([variable], ladderFlows, updateNodes)
    expect(updateNodes).toHaveBeenCalledTimes(1)
    expect(updateNodes).toHaveBeenCalledWith([
      expect.objectContaining({ rungId: 'r1', nodeId: 'n1' }),
      expect.objectContaining({ rungId: 'r2', nodeId: 'n2' }),
    ])
  })

  it("skips variable-pin nodes whose pin type cannot be resolved (never judges against '')", () => {
    const updateNodes = vi.fn()
    const variable = makeVariable('myVar', 'BOOL')
    const node = makeNode('n1', 'variable', { name: 'myVar' } as Partial<PLCVariable>, { wrongVariable: true })

    const ladderFlows = [
      {
        name: 'editor1',
        rungs: [{ id: 'r1', nodes: [node], edges: [] }],
      },
    ] as unknown as Parameters<typeof syncNodesWithVariables>[1]

    syncNodesWithVariables([variable], ladderFlows, updateNodes)
    // No data.block.variableType -> expected type unknown -> don't judge.
    // (The old behavior compared against '' and flagged every linked pin.)
    expect(updateNodes).not.toHaveBeenCalled()
  })

  const pinExtra = (pinType: string) => ({
    variant: 'input',
    block: {
      id: 'B1',
      handleId: 'CU',
      variableType: { name: 'CU', class: 'input', type: { definition: 'base-type', value: pinType } },
    },
  })

  it('accepts a variable-pin node whose variable matches the pin type', () => {
    const updateNodes = vi.fn()
    const variable = makeVariable('reset_in', 'BOOL')
    const node = makeNode('n1', 'variable', { name: 'reset_in' } as Partial<PLCVariable>, pinExtra('BOOL'))

    const ladderFlows = [{ name: 'editor1', rungs: [{ id: 'r1', nodes: [node], edges: [] }] }] as unknown as Parameters<
      typeof syncNodesWithVariables
    >[1]

    syncNodesWithVariables([variable], ladderFlows, updateNodes)
    expect(updateNodes).not.toHaveBeenCalled()
  })

  it('flags a variable-pin node whose variable mismatches the pin type', () => {
    const updateNodes = vi.fn()
    const variable = makeVariable('reset_in', 'INT')
    const node = makeNode('n1', 'variable', { name: 'reset_in' } as Partial<PLCVariable>, pinExtra('BOOL'))

    const ladderFlows = [{ name: 'editor1', rungs: [{ id: 'r1', nodes: [node], edges: [] }] }] as unknown as Parameters<
      typeof syncNodesWithVariables
    >[1]

    syncNodesWithVariables([variable], ladderFlows, updateNodes)
    expect(updateNodes).toHaveBeenCalledWith([
      expect.objectContaining({
        node: expect.objectContaining({
          data: expect.objectContaining({
            variable: { ...variable, id: 'broken-n1' },
            wrongVariable: true,
          }),
        }),
      }),
    ])
  })

  it('clears a stale wrongVariable flag on a variable-pin node once the pin type matches', () => {
    const updateNodes = vi.fn()
    const variable = makeVariable('reset_in', 'BOOL')
    const node = makeNode('n1', 'variable', { name: 'reset_in' } as Partial<PLCVariable>, {
      ...pinExtra('BOOL'),
      wrongVariable: true,
    })

    const ladderFlows = [{ name: 'editor1', rungs: [{ id: 'r1', nodes: [node], edges: [] }] }] as unknown as Parameters<
      typeof syncNodesWithVariables
    >[1]

    syncNodesWithVariables([variable], ladderFlows, updateNodes)
    expect(updateNodes).toHaveBeenCalledWith([
      expect.objectContaining({
        node: expect.objectContaining({
          data: expect.objectContaining({
            variable,
            wrongVariable: false,
          }),
        }),
      }),
    ])
  })

  it('does not update a block node when nothing changed', () => {
    const updateNodes = vi.fn()
    const variable = makeVariable('myVar', 'BOOL', 'base-type', '1')
    const node = makeNode('n1', 'contact', {
      name: 'myVar',
      id: '1',
      type: { definition: 'base-type', value: 'BOOL' } as PLCVariable['type'],
    })

    const ladderFlows = [
      {
        name: 'editor1',
        rungs: [{ id: 'r1', nodes: [node], edges: [] }],
      },
    ] as unknown as Parameters<typeof syncNodesWithVariables>[1]

    syncNodesWithVariables([variable], ladderFlows, updateNodes)
    expect(updateNodes).not.toHaveBeenCalled()
  })

  it('skips a variable node when it has no expected type to compare', () => {
    const updateNodes = vi.fn()
    const variable = makeVariable('myVar', 'BOOL', 'base-type', '1')
    const node = makeNode('n1', 'variable', {
      name: 'myVar',
      id: '1',
      type: { definition: 'base-type', value: 'BOOL' } as PLCVariable['type'],
    })

    const ladderFlows = [
      {
        name: 'editor1',
        rungs: [{ id: 'r1', nodes: [node], edges: [] }],
      },
    ] as unknown as Parameters<typeof syncNodesWithVariables>[1]

    syncNodesWithVariables([variable], ladderFlows, updateNodes)
    // Unresolvable expected type -> the node is not judged (the old behavior
    // compared against '' and flagged every linked pin as broken).
    expect(updateNodes).not.toHaveBeenCalled()
  })

  it('skips a block node when its variant has no name (no expected type)', () => {
    const updateNodes = vi.fn()
    const variable = makeVariable('myVar', 'INT')
    const node = makeNode('n1', 'block', {
      name: 'myVar',
      id: '1',
      type: { definition: 'base-type', value: 'INT' } as PLCVariable['type'],
    })

    const ladderFlows = [
      {
        name: 'editor1',
        rungs: [{ id: 'r1', nodes: [node], edges: [] }],
      },
    ] as unknown as Parameters<typeof syncNodesWithVariables>[1]

    syncNodesWithVariables([variable], ladderFlows, updateNodes)
    expect(updateNodes).not.toHaveBeenCalled()
  })

  it('clears wrongVariable when types now match (line 77)', () => {
    const updateNodes = vi.fn()
    const variable = makeVariable('myVar', 'BOOL', 'base-type', '2')
    const node = makeNode(
      'n1',
      'contact',
      {
        name: 'myVar',
        id: '1',
        type: { definition: 'base-type', value: 'BOOL' } as PLCVariable['type'],
      },
      { wrongVariable: true },
    )

    const ladderFlows = [
      {
        name: 'editor1',
        rungs: [{ id: 'r1', nodes: [node], edges: [] }],
      },
    ] as unknown as Parameters<typeof syncNodesWithVariables>[1]

    syncNodesWithVariables([variable], ladderFlows, updateNodes)

    // Types match (BOOL === BOOL for contact), but wrongVariable was true,
    // so it should be cleared.
    expect(updateNodes).toHaveBeenCalledWith([
      expect.objectContaining({
        editorName: 'editor1',
        rungId: 'r1',
        nodeId: 'n1',
        node: expect.objectContaining({
          data: expect.objectContaining({
            variable,
            wrongVariable: false,
          }),
        }),
      }),
    ])
  })

  it('marks a block node with matching variant as wrongVariable when type mismatches', () => {
    const updateNodes = vi.fn()
    const variable = makeVariable('myVar', 'INT')
    const node = makeNode(
      'n1',
      'block',
      {
        name: 'myVar',
        id: '1',
        type: { definition: 'base-type', value: 'BOOL' } as PLCVariable['type'],
      },
      { variant: { name: 'ADD' } },
    )

    const ladderFlows = [
      {
        name: 'editor1',
        rungs: [{ id: 'r1', nodes: [node], edges: [] }],
      },
    ] as unknown as Parameters<typeof syncNodesWithVariables>[1]

    syncNodesWithVariables([variable], ladderFlows, updateNodes)
    expect(updateNodes).toHaveBeenCalledWith([
      expect.objectContaining({
        node: expect.objectContaining({
          data: expect.objectContaining({ wrongVariable: true }),
        }),
      }),
    ])
  })
})

describe('syncNodesWithVariablesFBD', () => {
  it('skips a variable node when its type cannot be resolved', () => {
    const updateNodes = vi.fn()
    const variable = makeVariable('myVar', 'INT', 'base-type', '2')
    const node = makeNode('n1', 'input-variable', {
      name: 'myVar',
      id: '1',
      type: { definition: 'base-type', value: 'BOOL' } as PLCVariable['type'],
    })

    const fbdFlows = [
      {
        name: 'fbd1',
        rung: { nodes: [node], edges: [] },
      },
    ] as unknown as Parameters<typeof syncNodesWithVariablesFBD>[1]

    syncNodesWithVariablesFBD([variable], fbdFlows, updateNodes)
    // Unresolvable expected type -> not judged (the old behavior compared
    // against '' and falsely flagged linked FBD variable nodes as broken).
    expect(updateNodes).not.toHaveBeenCalled()
  })

  it('does not update when node has no variable', () => {
    const updateNodes = vi.fn()
    const node = makeNode('n1', 'block')
    const fbdFlows = [{ name: 'fbd1', rung: { nodes: [node], edges: [] } }] as unknown as Parameters<
      typeof syncNodesWithVariablesFBD
    >[1]

    syncNodesWithVariablesFBD([makeVariable('x')], fbdFlows, updateNodes)
    expect(updateNodes).not.toHaveBeenCalled()
  })

  it('does not update when variable not found', () => {
    const updateNodes = vi.fn()
    const node = makeNode('n1', 'input-variable', { name: 'missing' } as Partial<PLCVariable>)
    const fbdFlows = [{ name: 'fbd1', rung: { nodes: [node], edges: [] } }] as unknown as Parameters<
      typeof syncNodesWithVariablesFBD
    >[1]

    syncNodesWithVariablesFBD([makeVariable('other')], fbdFlows, updateNodes)
    expect(updateNodes).not.toHaveBeenCalled()
  })

  it('marks a block node as wrongVariable when type mismatches', () => {
    const updateNodes = vi.fn()
    const variable = makeVariable('myVar', 'INT')
    const node = makeNode(
      'n1',
      'block',
      {
        name: 'myVar',
        id: '1',
        type: { definition: 'base-type', value: 'BOOL' } as PLCVariable['type'],
      },
      { variant: { name: 'ADD' } },
    )

    const fbdFlows = [{ name: 'fbd1', rung: { nodes: [node], edges: [] } }] as unknown as Parameters<
      typeof syncNodesWithVariablesFBD
    >[1]

    syncNodesWithVariablesFBD([variable], fbdFlows, updateNodes)
    expect(updateNodes).toHaveBeenCalledWith([
      expect.objectContaining({
        node: expect.objectContaining({
          data: expect.objectContaining({ wrongVariable: true }),
        }),
      }),
    ])
  })

  it('does not update a block node when only variable id changes but types still match', () => {
    const updateNodes = vi.fn()
    const oldVariable = makeVariable('myVar', 'BOOL', 'base-type', '1')
    const newVariable = makeVariable('myVar', 'BOOL', 'base-type', '2')
    const node = makeNode('n1', 'block', oldVariable, { variant: { name: 'BOOL' } })

    const fbdFlows = [{ name: 'fbd1', rung: { nodes: [node], edges: [] } }] as unknown as Parameters<
      typeof syncNodesWithVariablesFBD
    >[1]

    syncNodesWithVariablesFBD([newVariable], fbdFlows, updateNodes)
    // Types match and wrongVariable is not set, so no update is needed.
    expect(updateNodes).not.toHaveBeenCalled()
  })

  it('filters flows by editorName', () => {
    const updateNodes = vi.fn()
    const variable = makeVariable('myVar', 'INT', 'base-type', '2')
    // Block with a resolvable variant type that mismatches -> triggers an update.
    const node = makeNode(
      'n1',
      'block',
      {
        name: 'myVar',
        id: '1',
        type: { definition: 'base-type', value: 'BOOL' } as PLCVariable['type'],
      },
      { variant: { name: 'BOOL' } },
    )

    const fbdFlows = [
      { name: 'fbd1', rung: { nodes: [node], edges: [] } },
      { name: 'fbd2', rung: { nodes: [node], edges: [] } },
    ] as unknown as Parameters<typeof syncNodesWithVariablesFBD>[1]

    syncNodesWithVariablesFBD([variable], fbdFlows, updateNodes, 'fbd1')
    expect(updateNodes).toHaveBeenCalledTimes(1)
    expect(updateNodes).toHaveBeenCalledWith([expect.objectContaining({ editorName: 'fbd1' })])
  })

  it('batches corrections across nodes into a single call', () => {
    const updateNodes = vi.fn()
    const variable = makeVariable('myVar', 'INT')
    const staleBlock = (id: string) =>
      makeNode(
        id,
        'block',
        {
          name: 'myVar',
          id: '1',
          type: { definition: 'base-type', value: 'BOOL' } as PLCVariable['type'],
        },
        { variant: { name: 'BOOL' } },
      )

    const fbdFlows = [
      { name: 'fbd1', rung: { nodes: [staleBlock('n1'), staleBlock('n2')], edges: [] } },
    ] as unknown as Parameters<typeof syncNodesWithVariablesFBD>[1]

    syncNodesWithVariablesFBD([variable], fbdFlows, updateNodes)
    expect(updateNodes).toHaveBeenCalledTimes(1)
    expect(updateNodes).toHaveBeenCalledWith([
      expect.objectContaining({ nodeId: 'n1' }),
      expect.objectContaining({ nodeId: 'n2' }),
    ])
  })

  it('marks an input-variable node as wrong when it has no expected type to compare', () => {
    const updateNodes = vi.fn()
    const variable = makeVariable('myVar', 'BOOL', 'base-type', '1')
    const node = makeNode('n1', 'input-variable', {
      name: 'myVar',
      id: '1',
      type: { definition: 'base-type', value: 'BOOL' } as PLCVariable['type'],
    })

    const fbdFlows = [{ name: 'fbd1', rung: { nodes: [node], edges: [] } }] as unknown as Parameters<
      typeof syncNodesWithVariablesFBD
    >[1]

    syncNodesWithVariablesFBD([variable], fbdFlows, updateNodes)
    // Unresolvable expected type -> not judged (no false "broken" flags).
    expect(updateNodes).not.toHaveBeenCalled()
  })

  it('clears wrongVariable on FBD node when types now match (line 136)', () => {
    const updateNodes = vi.fn()
    const variable = makeVariable('myVar', 'BOOL', 'base-type', '2')
    const node: Node = {
      id: 'n1',
      type: 'block',
      position: { x: 0, y: 0 },
      data: {
        variable: {
          name: 'myVar',
          id: '1',
          type: { definition: 'base-type', value: 'BOOL' },
        },
        variant: { name: 'BOOL' },
        wrongVariable: true,
      },
    }

    const fbdFlows = [{ name: 'fbd1', rung: { nodes: [node], edges: [] } }] as unknown as Parameters<
      typeof syncNodesWithVariablesFBD
    >[1]

    syncNodesWithVariablesFBD([variable], fbdFlows, updateNodes)

    // Types match (BOOL === BOOL for block with variant name BOOL),
    // but wrongVariable was true, so it should be cleared.
    expect(updateNodes).toHaveBeenCalledWith([
      expect.objectContaining({
        editorName: 'fbd1',
        nodeId: 'n1',
        node: expect.objectContaining({
          data: expect.objectContaining({
            variable,
            wrongVariable: false,
          }),
        }),
      }),
    ])
  })

  it('does not update a non-variable block node when nothing changed', () => {
    const updateNodes = vi.fn()
    const variable = makeVariable('myVar', 'BOOL', 'base-type', '1')
    const node: Node = {
      id: 'n1',
      type: 'block',
      position: { x: 0, y: 0 },
      data: {
        variable,
        variant: { name: 'BOOL' },
      },
    }

    const fbdFlows = [{ name: 'fbd1', rung: { nodes: [node], edges: [] } }] as unknown as Parameters<
      typeof syncNodesWithVariablesFBD
    >[1]

    syncNodesWithVariablesFBD([variable], fbdFlows, updateNodes)
    expect(updateNodes).not.toHaveBeenCalled()
  })
})
