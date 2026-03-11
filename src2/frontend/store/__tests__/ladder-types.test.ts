import {
  zodLadderFlowSchema,
  zodLadderFlowStateSchema,
  zodLadderNodeTypesSchema,
  zodRungLadderStateSchema,
} from '../slices/ladder/types'

describe('Ladder Zod schemas', () => {
  const validNode = {
    id: 'n1',
    type: 'block',
    position: { x: 0, y: 0 },
    draggable: true,
    selectable: true,
    data: {},
  }

  const validEdge = {
    id: 'e1',
    source: 'n1',
    sourceHandle: 'h1',
    target: 'n2',
    targetHandle: 'h2',
  }

  describe('zodRungLadderStateSchema', () => {
    it('validates a valid rung', () => {
      const result = zodRungLadderStateSchema.safeParse({
        id: 'rung-1',
        comment: 'test comment',
        defaultBounds: [800, 200],
        reactFlowViewport: [800, 200],
        nodes: [validNode],
        edges: [validEdge],
      })
      expect(result.success).toBe(true)
    })

    it('applies default comment', () => {
      const result = zodRungLadderStateSchema.safeParse({
        id: 'rung-1',
        defaultBounds: [800, 200],
        reactFlowViewport: [800, 200],
        nodes: [],
        edges: [],
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.comment).toBe('')
      }
    })

    it('rejects rung without id', () => {
      const result = zodRungLadderStateSchema.safeParse({
        comment: '',
        defaultBounds: [800, 200],
        reactFlowViewport: [800, 200],
        nodes: [],
        edges: [],
      })
      expect(result.success).toBe(false)
    })

    it('rejects rung with invalid bounds', () => {
      const result = zodRungLadderStateSchema.safeParse({
        id: 'rung-1',
        comment: '',
        defaultBounds: 'not-an-array',
        reactFlowViewport: [800, 200],
        nodes: [],
        edges: [],
      })
      expect(result.success).toBe(false)
    })
  })

  describe('zodLadderFlowSchema', () => {
    it('validates a valid flow', () => {
      const result = zodLadderFlowSchema.safeParse({
        name: 'test-flow',
        rungs: [
          {
            id: 'rung-1',
            comment: '',
            defaultBounds: [800, 200],
            reactFlowViewport: [800, 200],
            nodes: [],
            edges: [],
          },
        ],
      })
      expect(result.success).toBe(true)
    })

    it('applies default rungs', () => {
      const result = zodLadderFlowSchema.safeParse({
        name: 'test-flow',
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.rungs).toEqual([])
      }
    })

    it('rejects flow without name', () => {
      const result = zodLadderFlowSchema.safeParse({ rungs: [] })
      expect(result.success).toBe(false)
    })
  })

  describe('zodLadderFlowStateSchema', () => {
    it('validates a valid flow state', () => {
      const result = zodLadderFlowStateSchema.safeParse({
        ladderFlows: [{ name: 'flow-1', rungs: [] }],
      })
      expect(result.success).toBe(true)
    })

    it('validates empty flow state', () => {
      const result = zodLadderFlowStateSchema.safeParse({ ladderFlows: [] })
      expect(result.success).toBe(true)
    })
  })

  describe('zodLadderNodeTypesSchema', () => {
    const validTypes = ['block', 'contact', 'coil', 'parallel', 'powerRail', 'variable']

    it.each(validTypes)('accepts valid node type: %s', (type) => {
      const result = zodLadderNodeTypesSchema.safeParse(type)
      expect(result.success).toBe(true)
    })

    it('rejects invalid node type', () => {
      const result = zodLadderNodeTypesSchema.safeParse('invalid-type')
      expect(result.success).toBe(false)
    })
  })
})
