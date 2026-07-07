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
    const updateNode = vi.fn()
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

    syncNodesWithVariables([variable], ladderFlows, updateNode)

    // When type mismatches, variable id is set to "broken-<nodeId>" to mark it as broken.
    expect(updateNode).toHaveBeenCalledWith(
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
    )
  })

  it('does not update a contact node when only the variable id changes but types still match', () => {
    const updateNode = vi.fn()
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

    syncNodesWithVariables([variable], ladderFlows, updateNode)

    // Types match and wrongVariable is not set, so no update is needed.
    expect(updateNode).not.toHaveBeenCalled()
  })

  it('treats a POINTER TO <T> variable as compatible with a ULINT expected type', () => {
    // The sync path now delegates to the shared validateVariableType, so a
    // POINTER TO INT variable on a ULINT-typed block pin (e.g. ADR output)
    // must NOT be flagged as wrong.
    const updateNode = vi.fn()
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

    syncNodesWithVariables([variable], ladderFlows, updateNode)
    // Types are considered compatible and wrongVariable is not set, so no update.
    expect(updateNode).not.toHaveBeenCalled()
  })

  it('does not update when node has no variable', () => {
    const updateNode = vi.fn()
    const node = makeNode('n1', 'contact')
    const ladderFlows = [
      {
        name: 'editor1',
        rungs: [{ id: 'r1', nodes: [node], edges: [] }],
      },
    ] as unknown as Parameters<typeof syncNodesWithVariables>[1]

    syncNodesWithVariables([makeVariable('x')], ladderFlows, updateNode)
    expect(updateNode).not.toHaveBeenCalled()
  })

  it('does not update when variable is not found in newVars', () => {
    const updateNode = vi.fn()
    const node = makeNode('n1', 'contact', { name: 'missing' } as Partial<PLCVariable>)
    const ladderFlows = [
      {
        name: 'editor1',
        rungs: [{ id: 'r1', nodes: [node], edges: [] }],
      },
    ] as unknown as Parameters<typeof syncNodesWithVariables>[1]

    syncNodesWithVariables([makeVariable('other')], ladderFlows, updateNode)
    expect(updateNode).not.toHaveBeenCalled()
  })

  it('filters flows by editorName when provided', () => {
    const updateNode = vi.fn()
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

    syncNodesWithVariables([variable], ladderFlows, updateNode, 'editor1')
    expect(updateNode).toHaveBeenCalledTimes(1)
    expect(updateNode).toHaveBeenCalledWith(expect.objectContaining({ editorName: 'editor1' }))
  })

  it("skips variable-pin nodes whose pin type cannot be resolved (never judges against '')", () => {
    const updateNode = vi.fn()
    const variable = makeVariable('myVar', 'BOOL')
    const node = makeNode('n1', 'variable', { name: 'myVar' } as Partial<PLCVariable>, { wrongVariable: true })

    const ladderFlows = [
      {
        name: 'editor1',
        rungs: [{ id: 'r1', nodes: [node], edges: [] }],
      },
    ] as unknown as Parameters<typeof syncNodesWithVariables>[1]

    syncNodesWithVariables([variable], ladderFlows, updateNode)
    // No data.block.variableType -> expected type unknown -> don't judge.
    // (The old behavior compared against '' and flagged every linked pin.)
    expect(updateNode).not.toHaveBeenCalled()
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
    const updateNode = vi.fn()
    const variable = makeVariable('reset_in', 'BOOL')
    const node = makeNode('n1', 'variable', { name: 'reset_in' } as Partial<PLCVariable>, pinExtra('BOOL'))

    const ladderFlows = [{ name: 'editor1', rungs: [{ id: 'r1', nodes: [node], edges: [] }] }] as unknown as Parameters<
      typeof syncNodesWithVariables
    >[1]

    syncNodesWithVariables([variable], ladderFlows, updateNode)
    expect(updateNode).not.toHaveBeenCalled()
  })

  it('flags a variable-pin node whose variable mismatches the pin type', () => {
    const updateNode = vi.fn()
    const variable = makeVariable('reset_in', 'INT')
    const node = makeNode('n1', 'variable', { name: 'reset_in' } as Partial<PLCVariable>, pinExtra('BOOL'))

    const ladderFlows = [{ name: 'editor1', rungs: [{ id: 'r1', nodes: [node], edges: [] }] }] as unknown as Parameters<
      typeof syncNodesWithVariables
    >[1]

    syncNodesWithVariables([variable], ladderFlows, updateNode)
    expect(updateNode).toHaveBeenCalledWith(
      expect.objectContaining({
        node: expect.objectContaining({
          data: expect.objectContaining({
            variable: { ...variable, id: 'broken-n1' },
            wrongVariable: true,
          }),
        }),
      }),
    )
  })

  it('clears a stale wrongVariable flag on a variable-pin node once the pin type matches', () => {
    const updateNode = vi.fn()
    const variable = makeVariable('reset_in', 'BOOL')
    const node = makeNode('n1', 'variable', { name: 'reset_in' } as Partial<PLCVariable>, {
      ...pinExtra('BOOL'),
      wrongVariable: true,
    })

    const ladderFlows = [{ name: 'editor1', rungs: [{ id: 'r1', nodes: [node], edges: [] }] }] as unknown as Parameters<
      typeof syncNodesWithVariables
    >[1]

    syncNodesWithVariables([variable], ladderFlows, updateNode)
    expect(updateNode).toHaveBeenCalledWith(
      expect.objectContaining({
        node: expect.objectContaining({
          data: expect.objectContaining({
            variable,
            wrongVariable: false,
          }),
        }),
      }),
    )
  })

  it('does not update a block node when nothing changed', () => {
    const updateNode = vi.fn()
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

    syncNodesWithVariables([variable], ladderFlows, updateNode)
    expect(updateNode).not.toHaveBeenCalled()
  })

  it('skips a variable node when it has no expected type to compare', () => {
    const updateNode = vi.fn()
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

    syncNodesWithVariables([variable], ladderFlows, updateNode)
    // Unresolvable expected type -> the node is not judged (the old behavior
    // compared against '' and flagged every linked pin as broken).
    expect(updateNode).not.toHaveBeenCalled()
  })

  it('skips a block node when its variant has no name (no expected type)', () => {
    const updateNode = vi.fn()
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

    syncNodesWithVariables([variable], ladderFlows, updateNode)
    expect(updateNode).not.toHaveBeenCalled()
  })

  it('clears wrongVariable when types now match (line 77)', () => {
    const updateNode = vi.fn()
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

    syncNodesWithVariables([variable], ladderFlows, updateNode)

    // Types match (BOOL === BOOL for contact), but wrongVariable was true,
    // so it should be cleared.
    expect(updateNode).toHaveBeenCalledWith(
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
    )
  })

  it('marks a block node with matching variant as wrongVariable when type mismatches', () => {
    const updateNode = vi.fn()
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

    syncNodesWithVariables([variable], ladderFlows, updateNode)
    expect(updateNode).toHaveBeenCalledWith(
      expect.objectContaining({
        node: expect.objectContaining({
          data: expect.objectContaining({ wrongVariable: true }),
        }),
      }),
    )
  })
})

describe('syncNodesWithVariablesFBD', () => {
  it('skips a variable node when its type cannot be resolved', () => {
    const updateNode = vi.fn()
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

    syncNodesWithVariablesFBD([variable], fbdFlows, updateNode)
    // Unresolvable expected type -> not judged (the old behavior compared
    // against '' and falsely flagged linked FBD variable nodes as broken).
    expect(updateNode).not.toHaveBeenCalled()
  })

  it('does not update when node has no variable', () => {
    const updateNode = vi.fn()
    const node = makeNode('n1', 'block')
    const fbdFlows = [{ name: 'fbd1', rung: { nodes: [node], edges: [] } }] as unknown as Parameters<
      typeof syncNodesWithVariablesFBD
    >[1]

    syncNodesWithVariablesFBD([makeVariable('x')], fbdFlows, updateNode)
    expect(updateNode).not.toHaveBeenCalled()
  })

  it('does not update when variable not found', () => {
    const updateNode = vi.fn()
    const node = makeNode('n1', 'input-variable', { name: 'missing' } as Partial<PLCVariable>)
    const fbdFlows = [{ name: 'fbd1', rung: { nodes: [node], edges: [] } }] as unknown as Parameters<
      typeof syncNodesWithVariablesFBD
    >[1]

    syncNodesWithVariablesFBD([makeVariable('other')], fbdFlows, updateNode)
    expect(updateNode).not.toHaveBeenCalled()
  })

  it('marks a block node as wrongVariable when type mismatches', () => {
    const updateNode = vi.fn()
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

    syncNodesWithVariablesFBD([variable], fbdFlows, updateNode)
    expect(updateNode).toHaveBeenCalledWith(
      expect.objectContaining({
        node: expect.objectContaining({
          data: expect.objectContaining({ wrongVariable: true }),
        }),
      }),
    )
  })

  it('does not update a block node when only variable id changes but types still match', () => {
    const updateNode = vi.fn()
    const oldVariable = makeVariable('myVar', 'BOOL', 'base-type', '1')
    const newVariable = makeVariable('myVar', 'BOOL', 'base-type', '2')
    const node = makeNode('n1', 'block', oldVariable, { variant: { name: 'BOOL' } })

    const fbdFlows = [{ name: 'fbd1', rung: { nodes: [node], edges: [] } }] as unknown as Parameters<
      typeof syncNodesWithVariablesFBD
    >[1]

    syncNodesWithVariablesFBD([newVariable], fbdFlows, updateNode)
    // Types match and wrongVariable is not set, so no update is needed.
    expect(updateNode).not.toHaveBeenCalled()
  })

  it('filters flows by editorName', () => {
    const updateNode = vi.fn()
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

    syncNodesWithVariablesFBD([variable], fbdFlows, updateNode, 'fbd1')
    expect(updateNode).toHaveBeenCalledTimes(1)
    expect(updateNode).toHaveBeenCalledWith(expect.objectContaining({ editorName: 'fbd1' }))
  })

  it('marks an input-variable node as wrong when it has no expected type to compare', () => {
    const updateNode = vi.fn()
    const variable = makeVariable('myVar', 'BOOL', 'base-type', '1')
    const node = makeNode('n1', 'input-variable', {
      name: 'myVar',
      id: '1',
      type: { definition: 'base-type', value: 'BOOL' } as PLCVariable['type'],
    })

    const fbdFlows = [{ name: 'fbd1', rung: { nodes: [node], edges: [] } }] as unknown as Parameters<
      typeof syncNodesWithVariablesFBD
    >[1]

    syncNodesWithVariablesFBD([variable], fbdFlows, updateNode)
    // Unresolvable expected type -> not judged (no false "broken" flags).
    expect(updateNode).not.toHaveBeenCalled()
  })

  it('clears wrongVariable on FBD node when types now match (line 136)', () => {
    const updateNode = vi.fn()
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

    syncNodesWithVariablesFBD([variable], fbdFlows, updateNode)

    // Types match (BOOL === BOOL for block with variant name BOOL),
    // but wrongVariable was true, so it should be cleared.
    expect(updateNode).toHaveBeenCalledWith(
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
    )
  })

  it('does not update a non-variable block node when nothing changed', () => {
    const updateNode = vi.fn()
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

    syncNodesWithVariablesFBD([variable], fbdFlows, updateNode)
    expect(updateNode).not.toHaveBeenCalled()
  })
})
