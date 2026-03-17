import type { Node } from '@xyflow/react'

import type { PLCVariable } from '../../../../middleware/shared/ports/types'
import {
  getFunctionBlockVariablesToCleanup,
  isFunctionBlockVariableInUse,
} from '../get-function-block-variables-to-cleanup'

const makeBlockNode = (id: string, variableName: string, variantType: string): Node => ({
  id,
  type: 'block',
  position: { x: 0, y: 0 },
  data: {
    variable: { name: variableName },
    variant: { type: variantType },
  },
})

const makeNonBlockNode = (id: string): Node => ({
  id,
  type: 'contact',
  position: { x: 0, y: 0 },
  data: {},
})

const makeVariable = (name: string, definition: string): PLCVariable =>
  ({
    name,
    type: { definition, value: 'INT' },
  }) as unknown as PLCVariable

describe('isFunctionBlockVariableInUse', () => {
  it('returns true when a function-block node uses the variable', () => {
    const rungs = [{ nodes: [makeBlockNode('n1', 'myFB', 'function-block')] }]
    expect(isFunctionBlockVariableInUse('myFB', rungs)).toBe(true)
  })

  it('is case-insensitive', () => {
    const rungs = [{ nodes: [makeBlockNode('n1', 'MyFB', 'function-block')] }]
    expect(isFunctionBlockVariableInUse('myfb', rungs)).toBe(true)
  })

  it('returns false when the variable is not used', () => {
    const rungs = [{ nodes: [makeBlockNode('n1', 'otherFB', 'function-block')] }]
    expect(isFunctionBlockVariableInUse('myFB', rungs)).toBe(false)
  })

  it('returns false for non-function-block nodes with the same variable name', () => {
    const rungs = [
      {
        nodes: [makeBlockNode('n1', 'myFB', 'function')],
      },
    ]
    expect(isFunctionBlockVariableInUse('myFB', rungs)).toBe(false)
  })

  it('returns false for non-block nodes', () => {
    const rungs = [{ nodes: [makeNonBlockNode('n1')] }]
    expect(isFunctionBlockVariableInUse('myFB', rungs)).toBe(false)
  })

  it('checks across multiple rungs', () => {
    const rungs = [{ nodes: [makeNonBlockNode('n1')] }, { nodes: [makeBlockNode('n2', 'myFB', 'function-block')] }]
    expect(isFunctionBlockVariableInUse('myFB', rungs)).toBe(true)
  })

  it('returns false for empty rungs', () => {
    expect(isFunctionBlockVariableInUse('myFB', [])).toBe(false)
  })
})

describe('getFunctionBlockVariablesToCleanup', () => {
  it('returns variable names for unused function-block variables', () => {
    const removedNodes = [makeBlockNode('n1', 'fbVar', 'function-block')]
    const allRungs: Array<{ nodes: Node[] }> = [{ nodes: [] }]
    const allVariables = [makeVariable('fbVar', 'derived')]

    const result = getFunctionBlockVariablesToCleanup(removedNodes, allRungs, allVariables)
    expect(result).toEqual(['fbVar'])
  })

  it('does not return variables still in use in other rungs', () => {
    const removedNodes = [makeBlockNode('n1', 'fbVar', 'function-block')]
    const allRungs = [{ nodes: [makeBlockNode('n2', 'fbVar', 'function-block')] }]
    const allVariables = [makeVariable('fbVar', 'derived')]

    const result = getFunctionBlockVariablesToCleanup(removedNodes, allRungs, allVariables)
    expect(result).toEqual([])
  })

  it('does not return non-derived variables', () => {
    const removedNodes = [makeBlockNode('n1', 'fbVar', 'function-block')]
    const allRungs: Array<{ nodes: Node[] }> = [{ nodes: [] }]
    const allVariables = [makeVariable('fbVar', 'base-type')]

    const result = getFunctionBlockVariablesToCleanup(removedNodes, allRungs, allVariables)
    expect(result).toEqual([])
  })

  it('skips non-block and non-function-block nodes', () => {
    const removedNodes = [makeNonBlockNode('n1'), makeBlockNode('n2', 'regularFn', 'function')]
    const allRungs: Array<{ nodes: Node[] }> = [{ nodes: [] }]
    const allVariables = [makeVariable('regularFn', 'derived')]

    const result = getFunctionBlockVariablesToCleanup(removedNodes, allRungs, allVariables)
    expect(result).toEqual([])
  })

  it('skips function-block nodes without a variable name', () => {
    const node: Node = {
      id: 'n1',
      type: 'block',
      position: { x: 0, y: 0 },
      data: { variant: { type: 'function-block' } },
    }
    const allRungs: Array<{ nodes: Node[] }> = [{ nodes: [] }]
    const allVariables: PLCVariable[] = []

    const result = getFunctionBlockVariablesToCleanup([node], allRungs, allVariables)
    expect(result).toEqual([])
  })

  it('skips variables not found in allVariables', () => {
    const removedNodes = [makeBlockNode('n1', 'unknownFB', 'function-block')]
    const allRungs: Array<{ nodes: Node[] }> = [{ nodes: [] }]
    const allVariables: PLCVariable[] = []

    const result = getFunctionBlockVariablesToCleanup(removedNodes, allRungs, allVariables)
    expect(result).toEqual([])
  })

  it('de-duplicates variables from multiple removed nodes', () => {
    const removedNodes = [
      makeBlockNode('n1', 'fbVar', 'function-block'),
      makeBlockNode('n2', 'fbVar', 'function-block'),
    ]
    const allRungs: Array<{ nodes: Node[] }> = [{ nodes: [] }]
    const allVariables = [makeVariable('fbVar', 'derived')]

    const result = getFunctionBlockVariablesToCleanup(removedNodes, allRungs, allVariables)
    expect(result).toEqual(['fbVar'])
  })

  it('handles case-insensitive variable matching', () => {
    const removedNodes = [makeBlockNode('n1', 'MyFB', 'function-block')]
    const allRungs: Array<{ nodes: Node[] }> = [{ nodes: [] }]
    const allVariables = [makeVariable('myfb', 'derived')]

    const result = getFunctionBlockVariablesToCleanup(removedNodes, allRungs, allVariables)
    expect(result).toEqual(['MyFB'])
  })
})
