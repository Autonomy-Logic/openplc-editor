import {
  zodFBDFlowSchema,
  zodFBDFlowStateSchema,
  zodFBDNodeTypesSchema,
  zodFBDRungStateSchema,
} from '../slices/fbd/types'

describe('FBD Zod schemas', () => {
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

  describe('zodFBDRungStateSchema', () => {
    it('validates a valid rung', () => {
      const result = zodFBDRungStateSchema.safeParse({
        comment: 'test comment',
        nodes: [validNode],
        edges: [validEdge],
      })
      expect(result.success).toBe(true)
    })

    it('applies default comment', () => {
      const result = zodFBDRungStateSchema.safeParse({
        nodes: [],
        edges: [],
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.comment).toBe('')
      }
    })

    it('rejects rung with invalid nodes', () => {
      const result = zodFBDRungStateSchema.safeParse({
        comment: '',
        nodes: [{ invalid: true }],
        edges: [],
      })
      expect(result.success).toBe(false)
    })
  })

  describe('zodFBDFlowSchema', () => {
    it('validates a valid flow', () => {
      const result = zodFBDFlowSchema.safeParse({
        name: 'test-flow',
        rung: { comment: '', nodes: [], edges: [] },
      })
      expect(result.success).toBe(true)
    })

    it('rejects flow without name', () => {
      const result = zodFBDFlowSchema.safeParse({
        rung: { comment: '', nodes: [], edges: [] },
      })
      expect(result.success).toBe(false)
    })
  })

  describe('zodFBDFlowStateSchema', () => {
    it('validates a valid flow state', () => {
      const result = zodFBDFlowStateSchema.safeParse({
        fbdFlows: [
          {
            name: 'flow-1',
            rung: { comment: '', nodes: [], edges: [] },
          },
        ],
      })
      expect(result.success).toBe(true)
    })

    it('validates empty flow state', () => {
      const result = zodFBDFlowStateSchema.safeParse({ fbdFlows: [] })
      expect(result.success).toBe(true)
    })
  })

  describe('zodFBDNodeTypesSchema', () => {
    const validTypes = [
      'block',
      'comment',
      'connector',
      'connection',
      'input-variable',
      'output-variable',
      'inout-variable',
    ]

    it.each(validTypes)('accepts valid node type: %s', (type) => {
      const result = zodFBDNodeTypesSchema.safeParse(type)
      expect(result.success).toBe(true)
    })

    it('rejects invalid node type', () => {
      const result = zodFBDNodeTypesSchema.safeParse('invalid-type')
      expect(result.success).toBe(false)
    })
  })
})
