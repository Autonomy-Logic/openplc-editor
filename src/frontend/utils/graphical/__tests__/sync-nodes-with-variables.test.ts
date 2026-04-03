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

  it('keeps a variable node marked as wrongVariable when type cannot be resolved', () => {
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
    // Node type 'variable' has no expected type (getBlockExpectedType returns ''),
    // so the type comparison always fails and the node stays marked as wrong.
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

  it('marks a variable node as wrong when it has no expected type to compare', () => {
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
    // Node type 'variable' has no expected type (getBlockExpectedType returns ''),
    // so the type comparison always fails and the node is flagged as wrong.
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

  it('marks a block node as wrongVariable when variant has no name', () => {
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
    expect(updateNode).toHaveBeenCalledWith(
      expect.objectContaining({
        node: expect.objectContaining({
          data: expect.objectContaining({ wrongVariable: true }),
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
  it('marks a variable node as wrong when type cannot be resolved', () => {
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
    // Node type 'input-variable' has no expected type (getBlockExpectedType returns ''),
    // so the type comparison always fails and the node is marked as wrong with a broken id.
    expect(updateNode).toHaveBeenCalledWith(
      expect.objectContaining({
        editorName: 'fbd1',
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
    const node = makeNode('n1', 'input-variable', {
      name: 'myVar',
      id: '1',
      type: { definition: 'base-type', value: 'BOOL' } as PLCVariable['type'],
    })

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
    // Node type 'input-variable' has no expected type (getBlockExpectedType returns ''),
    // so the type comparison always fails and the node is flagged as wrong.
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
