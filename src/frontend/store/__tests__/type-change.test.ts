import type { Node } from '@xyflow/react'

import type { PLCVariable } from '../../../middleware/shared/ports/types'
import { validateNodeVariableCompatibility, validateTypeChange } from '../slices/project/validation/type-change'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(id: string, type: string, data: Record<string, unknown>): Node {
  return { id, type, data, position: { x: 0, y: 0 } } as Node
}

function makeVariable(name: string, overrides: Partial<PLCVariable> = {}): PLCVariable {
  return {
    name,
    class: 'local',
    type: { definition: 'base-type', value: 'INT' },
    location: '',
    documentation: '',
    ...overrides,
  }
}

type LadderFlow = {
  name: string
  updated: boolean
  rungs: Array<{
    id: string
    selectedNodes: Node[]
    nodes: Node[]
    edges: never[]
    comment: string
    defaultBounds: number[]
    reactFlowViewport: number[]
  }>
}
type FBDFlow = {
  name: string
  updated: boolean
  rung: { selectedNodes: Node[]; nodes: Node[]; edges: never[]; comment: string }
}

function makeLadderFlow(name: string, nodes: Node[] = []): LadderFlow {
  return {
    name,
    updated: false,
    rungs: [
      {
        id: 'rung-1',
        selectedNodes: [],
        nodes,
        edges: [],
        comment: '',
        defaultBounds: [],
        reactFlowViewport: [],
      },
    ],
  }
}

function makeFBDFlow(name: string, nodes: Node[] = []): FBDFlow {
  return {
    name,
    updated: false,
    rung: { selectedNodes: [], nodes, edges: [], comment: '' },
  }
}

// ---------------------------------------------------------------------------
// getBlockExpectedType (via validateTypeChange / validateNodeVariableCompatibility)
// ---------------------------------------------------------------------------

describe('validateTypeChange', () => {
  it('returns empty result when no flows have matching variable', () => {
    const result = validateTypeChange(
      'x',
      { definition: 'base-type', value: 'INT' },
      { definition: 'base-type', value: 'REAL' },
      [],
      [],
    )
    expect(result.canChange).toBe(true)
    expect(result.affectedNodes).toHaveLength(0)
  })

  describe('ladder flows', () => {
    it('detects affected contact nodes', () => {
      const flows = [makeLadderFlow('P1', [makeNode('n1', 'contact', { variable: makeVariable('x') })])]
      const result = validateTypeChange(
        'x',
        { definition: 'base-type', value: 'BOOL' },
        { definition: 'base-type', value: 'INT' },
        flows as never,
        [],
      )
      expect(result.affectedNodes).toHaveLength(1)
      expect(result.affectedNodes[0].nodeType).toBe('contact')
      expect(result.affectedNodes[0].expectedType).toBe('BOOL')
    })

    it('detects affected coil nodes', () => {
      const flows = [makeLadderFlow('P1', [makeNode('n1', 'coil', { variable: makeVariable('x') })])]
      const result = validateTypeChange(
        'x',
        { definition: 'base-type', value: 'BOOL' },
        { definition: 'base-type', value: 'INT' },
        flows as never,
        [],
      )
      expect(result.affectedNodes).toHaveLength(1)
      expect(result.affectedNodes[0].nodeType).toBe('coil')
    })

    it('detects affected block nodes with variant', () => {
      const flows = [
        makeLadderFlow('P1', [
          makeNode('n1', 'block', {
            variable: makeVariable('x'),
            variant: { name: 'ADD' },
          }),
        ]),
      ]
      const result = validateTypeChange(
        'x',
        { definition: 'base-type', value: 'INT' },
        { definition: 'base-type', value: 'REAL' },
        flows as never,
        [],
      )
      expect(result.affectedNodes).toHaveLength(1)
    })

    it('returns empty expectedType for block without variant', () => {
      const flows = [makeLadderFlow('P1', [makeNode('n1', 'block', { variable: makeVariable('x') })])]
      const result = validateTypeChange(
        'x',
        { definition: 'base-type', value: 'INT' },
        { definition: 'base-type', value: 'REAL' },
        flows as never,
        [],
      )
      expect(result.affectedNodes).toHaveLength(1)
      expect(result.affectedNodes[0].expectedType).toBe('')
      expect(result.affectedNodes[0].isCompatible).toBe(true)
    })

    it('skips nodes that do not match the variable name', () => {
      const flows = [makeLadderFlow('P1', [makeNode('n1', 'contact', { variable: makeVariable('other') })])]
      const result = validateTypeChange(
        'x',
        { definition: 'base-type', value: 'INT' },
        { definition: 'base-type', value: 'REAL' },
        flows as never,
        [],
      )
      expect(result.affectedNodes).toHaveLength(0)
    })

    it('skips nodes without a variable', () => {
      const flows = [makeLadderFlow('P1', [makeNode('n1', 'contact', {})])]
      const result = validateTypeChange(
        'x',
        { definition: 'base-type', value: 'INT' },
        { definition: 'base-type', value: 'REAL' },
        flows as never,
        [],
      )
      expect(result.affectedNodes).toHaveLength(0)
    })

    it('uses "unknown" for node.type when node.type is undefined', () => {
      const node = makeNode('n1', 'contact', { variable: makeVariable('x') })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(node as any).type = undefined
      const flows = [makeLadderFlow('P1', [node])]
      const result = validateTypeChange(
        'x',
        { definition: 'base-type', value: 'INT' },
        { definition: 'base-type', value: 'REAL' },
        flows as never,
        [],
      )
      expect(result.affectedNodes).toHaveLength(1)
      expect(result.affectedNodes[0].nodeType).toBe('unknown')
    })
  })

  describe('FBD flows', () => {
    it('detects affected FBD nodes', () => {
      const flows = [makeFBDFlow('P1', [makeNode('n1', 'contact', { variable: makeVariable('x') })])]
      const result = validateTypeChange(
        'x',
        { definition: 'base-type', value: 'BOOL' },
        { definition: 'base-type', value: 'INT' },
        [],
        flows as never,
      )
      expect(result.affectedNodes).toHaveLength(1)
      expect(result.affectedNodes[0].pouName).toBe('P1')
    })

    it('skips FBD nodes without a variable', () => {
      const flows = [makeFBDFlow('P1', [makeNode('n1', 'contact', {})])]
      const result = validateTypeChange(
        'x',
        { definition: 'base-type', value: 'INT' },
        { definition: 'base-type', value: 'REAL' },
        [],
        flows as never,
      )
      expect(result.affectedNodes).toHaveLength(0)
    })

    it('skips FBD nodes where variable name does not match', () => {
      const flows = [makeFBDFlow('P1', [makeNode('n1', 'contact', { variable: makeVariable('other') })])]
      const result = validateTypeChange(
        'x',
        { definition: 'base-type', value: 'INT' },
        { definition: 'base-type', value: 'REAL' },
        [],
        flows as never,
      )
      expect(result.affectedNodes).toHaveLength(0)
    })

    it('uses "unknown" for FBD node.type when undefined', () => {
      const node = makeNode('n1', 'contact', { variable: makeVariable('x') })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(node as any).type = undefined
      const flows = [makeFBDFlow('P1', [node])]
      const result = validateTypeChange(
        'x',
        { definition: 'base-type', value: 'INT' },
        { definition: 'base-type', value: 'REAL' },
        [],
        flows as never,
      )
      expect(result.affectedNodes[0].nodeType).toBe('unknown')
    })
  })

  describe('global scope', () => {
    it('checks only POUs that have external variables matching the name', () => {
      const pous = [
        { name: 'P1', interface: { variables: [makeVariable('g', { class: 'external' })] } },
        { name: 'P2', interface: { variables: [makeVariable('other', { class: 'local' })] } },
      ]
      const ladderFlows = [
        makeLadderFlow('P1', [makeNode('n1', 'contact', { variable: makeVariable('g') })]),
        makeLadderFlow('P2', [makeNode('n2', 'contact', { variable: makeVariable('g') })]),
      ]
      const result = validateTypeChange(
        'g',
        { definition: 'base-type', value: 'BOOL' },
        { definition: 'base-type', value: 'INT' },
        ladderFlows as never,
        [],
        'global',
        pous,
      )
      // Only P1 has external variable 'g', so only its flows are checked
      expect(result.affectedNodes).toHaveLength(1)
      expect(result.affectedNodes[0].pouName).toBe('P1')
      expect(result.warnings.some((w) => w.includes('P1'))).toBe(true)
    })

    it('adds no warnings when no POUs have matching external variable', () => {
      const pous = [{ name: 'P1', interface: { variables: [makeVariable('x', { class: 'local' })] } }]
      const result = validateTypeChange(
        'g',
        { definition: 'base-type', value: 'INT' },
        { definition: 'base-type', value: 'REAL' },
        [],
        [],
        'global',
        pous,
      )
      expect(result.warnings).toHaveLength(0)
    })

    it('handles global scope without pous parameter', () => {
      const result = validateTypeChange(
        'g',
        { definition: 'base-type', value: 'INT' },
        { definition: 'base-type', value: 'REAL' },
        [],
        [],
        'global',
      )
      expect(result.affectedNodes).toHaveLength(0)
    })

    it('handles pous with no interface in global scope', () => {
      const pous = [{ name: 'P1' }]
      const result = validateTypeChange(
        'g',
        { definition: 'base-type', value: 'INT' },
        { definition: 'base-type', value: 'REAL' },
        [],
        [],
        'global',
        pous as never,
      )
      expect(result.affectedNodes).toHaveLength(0)
    })

    it('skips FBD flows whose name is not in the global pouNamesToCheck list', () => {
      const pous = [{ name: 'P1', interface: { variables: [makeVariable('g', { class: 'external' })] } }]
      // FBD flow P2 is NOT in the global scope list (only P1 has external 'g')
      const fbdFlows = [makeFBDFlow('P2', [makeNode('n1', 'contact', { variable: makeVariable('g') })])]
      const result = validateTypeChange(
        'g',
        { definition: 'base-type', value: 'BOOL' },
        { definition: 'base-type', value: 'INT' },
        [],
        fbdFlows as never,
        'global',
        pous,
      )
      expect(result.affectedNodes).toHaveLength(0)
    })
  })

  describe('warnings', () => {
    it('adds incompatibility warning when nodes become incompatible', () => {
      const flows = [makeLadderFlow('P1', [makeNode('n1', 'contact', { variable: makeVariable('x') })])]
      // contact expects BOOL; changing to STRING will be incompatible
      const result = validateTypeChange(
        'x',
        { definition: 'base-type', value: 'BOOL' },
        { definition: 'base-type', value: 'STRING' },
        flows as never,
        [],
      )
      expect(result.incompatibleCount).toBeGreaterThan(0)
      expect(result.warnings.some((w) => w.includes('incompatible'))).toBe(true)
    })

    it('adds warning when changing from base-type to derived type', () => {
      const result = validateTypeChange(
        'x',
        { definition: 'base-type', value: 'INT' },
        { definition: 'derived', value: 'TON' },
        [],
        [],
      )
      expect(result.warnings.some((w) => w.includes('derived type'))).toBe(true)
    })

    it('does not add derived-type warning when old type is not base-type', () => {
      const result = validateTypeChange(
        'x',
        { definition: 'derived', value: 'TON' },
        { definition: 'derived', value: 'TOF' },
        [],
        [],
      )
      expect(result.warnings.every((w) => !w.includes('derived type'))).toBe(true)
    })
  })

  describe('compatibility counting', () => {
    it('correctly counts compatible and incompatible nodes', () => {
      // contact expects BOOL — BOOL -> BOOL is compatible
      const ladderFlows = [
        makeLadderFlow('P1', [
          makeNode('n1', 'contact', { variable: makeVariable('x') }),
          makeNode('n2', 'block', { variable: makeVariable('x') }),
        ]),
      ]
      const result = validateTypeChange(
        'x',
        { definition: 'base-type', value: 'BOOL' },
        { definition: 'base-type', value: 'BOOL' },
        ladderFlows as never,
        [],
      )
      // contact: expects BOOL, new type BOOL -> compatible
      // block (no variant): no expected type -> compatible
      expect(result.compatibleCount).toBe(2)
      expect(result.incompatibleCount).toBe(0)
    })
  })
})

// ---------------------------------------------------------------------------
// validateNodeVariableCompatibility
// ---------------------------------------------------------------------------

describe('validateNodeVariableCompatibility', () => {
  it('returns compatible when node expects no specific type', () => {
    const node = makeNode('n1', 'block', {})
    const variable = makeVariable('x')
    const result = validateNodeVariableCompatibility(node, variable)
    expect(result.isCompatible).toBe(true)
  })

  it('returns compatible when variable matches expected type', () => {
    const node = makeNode('n1', 'contact', {})
    const variable = makeVariable('x', { type: { definition: 'base-type', value: 'BOOL' } })
    const result = validateNodeVariableCompatibility(node, variable)
    expect(result.isCompatible).toBe(true)
  })

  it('returns incompatible when variable type does not match', () => {
    const node = makeNode('n1', 'contact', {})
    const variable = makeVariable('x', { type: { definition: 'base-type', value: 'STRING' } })
    const result = validateNodeVariableCompatibility(node, variable)
    expect(result.isCompatible).toBe(false)
    expect(result.message).toBeDefined()
  })

  it('returns compatible for block with variant expecting ANY', () => {
    const node = makeNode('n1', 'block', { variant: { name: 'ANY' } })
    const variable = makeVariable('x', { type: { definition: 'base-type', value: 'INT' } })
    const result = validateNodeVariableCompatibility(node, variable)
    expect(result.isCompatible).toBe(true)
  })
})
