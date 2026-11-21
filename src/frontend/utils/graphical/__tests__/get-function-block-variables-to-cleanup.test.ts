import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Node } from '@xyflow/react'

import type { PLCVariable, VariableClass } from '../../../../middleware/shared/ports/types'
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

const makeVariableNode = (id: string, type: string, expression: string): Node => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: { variable: { name: expression } },
})

const makeVariable = (name: string, definition: string): PLCVariable =>
  ({
    name,
    class: 'local',
    type: { definition, value: 'INT' },
  }) as unknown as PLCVariable

const makeTonDeclaration = (name: string, variableClass?: VariableClass): PLCVariable => ({
  name,
  ...(variableClass ? { class: variableClass } : {}),
  type: { definition: 'derived', value: 'TON' },
  location: '',
  documentation: '',
})

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

describe('getFunctionBlockVariablesToCleanup with the diagram still holding the removed nodes', () => {
  it('returns the instance when the only block using it is the removed one, still present in the diagram', () => {
    const removedBlock = makeBlockNode('block-1', 'TON0', 'function-block')
    const staleRungs = [{ nodes: [removedBlock] }]

    const result = getFunctionBlockVariablesToCleanup([removedBlock], staleRungs, [makeVariable('TON0', 'derived')])

    expect(result).toEqual(['TON0'])
  })

  it('returns the instance when a removed contact on its output is also still present in the diagram', () => {
    const removedBlock = makeBlockNode('block-1', 'TON0', 'function-block')
    const removedContact = makeVariableNode('contact-1', 'contact', 'TON0.Q')
    const staleRungs = [{ nodes: [removedBlock, removedContact] }]

    const result = getFunctionBlockVariablesToCleanup([removedBlock, removedContact], staleRungs, [
      makeVariable('TON0', 'derived'),
    ])

    expect(result).toEqual(['TON0'])
  })

  it('keeps the instance when another block with a different id still uses it', () => {
    const removedBlock = makeBlockNode('block-1', 'TON0', 'function-block')
    const otherBlock = makeBlockNode('block-2', 'TON0', 'function-block')

    const result = getFunctionBlockVariablesToCleanup(
      [removedBlock],
      [{ nodes: [removedBlock, otherBlock] }],
      [makeVariable('TON0', 'derived')],
    )

    expect(result).toEqual([])
  })
})

describe('getFunctionBlockVariablesToCleanup with the instance referenced by an expression', () => {
  const removedBlock = makeBlockNode('block-1', 'TON0', 'function-block')
  const instance = makeVariable('TON0', 'derived')

  it.each(['TON0', 'TON0.Q', 'ton0.ET', 'NOT TON0.Q', 'TON0.Q AND x', 'NOT ton0.Q'])(
    'keeps the instance when a contact in another rung reads %s',
    (expression) => {
      const rungs = [{ nodes: [] }, { nodes: [makeVariableNode('contact-1', 'contact', expression)] }]

      expect(getFunctionBlockVariablesToCleanup([removedBlock], rungs, [instance])).toEqual([])
    },
  )

  it.each(['coil', 'variable', 'input-variable', 'output-variable', 'inout-variable'])(
    'keeps the instance when one of its members is read by a %s node',
    (nodeType) => {
      const rungs = [{ nodes: [makeVariableNode('node-1', nodeType, 'TON0.ET')] }]

      expect(getFunctionBlockVariablesToCleanup([removedBlock], rungs, [instance])).toEqual([])
    },
  )

  it.each(['TON01', 'MyTON0', 'X.TON0', ''])(
    'returns the instance when the only other node reads %p, which is not the instance',
    (expression) => {
      const rungs = [{ nodes: [makeVariableNode('contact-1', 'contact', expression)] }]

      expect(getFunctionBlockVariablesToCleanup([removedBlock], rungs, [instance])).toEqual(['TON0'])
    },
  )

  it('returns the instance when a block of a function variant carries the same name', () => {
    const rungs = [{ nodes: [makeBlockNode('block-2', 'TON0', 'function')] }]

    expect(getFunctionBlockVariablesToCleanup([removedBlock], rungs, [instance])).toEqual(['TON0'])
  })
})

describe('getFunctionBlockVariablesToCleanup with a user-defined function block', () => {
  it('returns the instance of a removed user function block that nothing references', () => {
    const removedBlock: Node = {
      id: 'block-1',
      type: 'block',
      position: { x: 0, y: 0 },
      data: { variable: { name: 'MyFB0' }, variant: { name: 'MyFB', type: 'function-block' } },
    }
    const instance = {
      name: 'MyFB0',
      class: 'local',
      type: { definition: 'derived', value: 'MyFB' },
    } as unknown as PLCVariable

    expect(getFunctionBlockVariablesToCleanup([removedBlock], [{ nodes: [] }], [instance])).toEqual(['MyFB0'])
  })
})

describe('getFunctionBlockVariablesToCleanup with the bound variable declared by the user in another class', () => {
  const removedBlock = makeBlockNode('block-1', 'ExtTimer', 'function-block')

  it.each<VariableClass>(['external', 'inOut', 'input', 'output', 'temp', 'global'])(
    'keeps an unreferenced %s declaration bound to the removed TON block',
    (variableClass) => {
      const declarations = [makeTonDeclaration('ExtTimer', variableClass)]

      expect(getFunctionBlockVariablesToCleanup([removedBlock], [{ nodes: [] }], declarations)).toEqual([])
    },
  )

  it('keeps an unreferenced declaration with no class bound to the removed TON block', () => {
    const declarations = [makeTonDeclaration('ExtTimer')]

    expect(getFunctionBlockVariablesToCleanup([removedBlock], [{ nodes: [] }], declarations)).toEqual([])
  })

  it('returns the unreferenced local instance bound to the removed TON block', () => {
    const declarations = [makeTonDeclaration('ExtTimer', 'local')]

    expect(getFunctionBlockVariablesToCleanup([removedBlock], [{ nodes: [] }], declarations)).toEqual(['ExtTimer'])
  })

  it('returns the local instance and keeps the input declaration when both bound blocks are removed', () => {
    const removedBlocks = [removedBlock, makeBlockNode('block-2', 'TON1', 'function-block')]
    const declarations = [makeTonDeclaration('ExtTimer', 'input'), makeTonDeclaration('TON1', 'local')]

    expect(getFunctionBlockVariablesToCleanup(removedBlocks, [{ nodes: [] }], declarations)).toEqual(['TON1'])
  })
})

describe('get-function-block-variables-to-cleanup source', () => {
  it('uses no regular expression lookbehind', () => {
    const source = readFileSync(join(__dirname, '../get-function-block-variables-to-cleanup.ts'), 'utf-8')
    const linesWithLookbehind = source.split('\n').filter((line) => /\(\?<[=!]/.test(line))

    expect(linesWithLookbehind).toEqual([])
  })
})

describe('in a runtime whose regular expressions reject lookbehind', () => {
  const NativeRegExp = globalThis.RegExp
  const removedBlock = makeBlockNode('block-1', 'TON0', 'function-block')
  const instance = makeVariable('TON0', 'derived')

  beforeEach(() => {
    globalThis.RegExp = new Proxy(NativeRegExp, {
      construct(target, [pattern, flags]: [RegExp | string, string | undefined]) {
        const source = pattern instanceof NativeRegExp ? pattern.source : String(pattern)
        if (source.includes('(?<=') || source.includes('(?<!')) {
          throw new SyntaxError(`Invalid regular expression: /${source}/: Invalid group`)
        }
        return new target(pattern, flags)
      },
    })
  })

  afterEach(() => {
    globalThis.RegExp = NativeRegExp
  })

  it('reports the instance in use when a contact reads TON0.Q, without throwing', () => {
    const rungs = [{ nodes: [makeVariableNode('contact-1', 'contact', 'TON0.Q')] }]

    expect(isFunctionBlockVariableInUse('TON0', rungs)).toBe(true)
  })

  it.each(['NOT ton0.Q', '(TON0.Q)'])('treats %s as a reference to the instance', (expression) => {
    const rungs = [{ nodes: [makeVariableNode('contact-1', 'contact', expression)] }]

    expect(isFunctionBlockVariableInUse('TON0', rungs)).toBe(true)
  })

  it.each(['X.TON0', 'MyTON0', 'TON01'])('does not treat %s as a reference to the instance', (expression) => {
    const rungs = [{ nodes: [makeVariableNode('contact-1', 'contact', expression)] }]

    expect(isFunctionBlockVariableInUse('TON0', rungs)).toBe(false)
  })

  it('keeps the instance of a deleted TON block while a contact in another rung reads TON0.Q', () => {
    const rungs = [{ nodes: [removedBlock] }, { nodes: [makeVariableNode('contact-1', 'contact', 'TON0.Q')] }]

    expect(getFunctionBlockVariablesToCleanup([removedBlock], rungs, [instance])).toEqual([])
  })

  it('removes the instance of a deleted TON block that nothing else references', () => {
    const rungs = [{ nodes: [removedBlock] }, { nodes: [makeVariableNode('contact-1', 'contact', 'x')] }]

    expect(getFunctionBlockVariablesToCleanup([removedBlock], rungs, [instance])).toEqual(['TON0'])
  })
})
