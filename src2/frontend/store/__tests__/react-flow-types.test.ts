import { edgeSchema, nodeSchema } from '../slices/react-flow/types'

describe('react-flow Zod schemas', () => {
  describe('nodeSchema', () => {
    it('validates a valid node', () => {
      const result = nodeSchema.safeParse({
        id: 'node-1',
        type: 'block',
        position: { x: 10, y: 20 },
        draggable: true,
        selectable: true,
        data: { label: 'test' },
      })
      expect(result.success).toBe(true)
    })

    it('validates a node with optional fields', () => {
      const result = nodeSchema.safeParse({
        id: 'node-1',
        type: 'block',
        position: { x: 0, y: 0 },
        height: 100,
        width: 200,
        measured: { width: 200, height: 100 },
        draggable: false,
        selectable: false,
        data: {},
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.height).toBe(100)
        expect(result.data.width).toBe(200)
        expect(result.data.measured).toEqual({ width: 200, height: 100 })
      }
    })

    it('rejects node missing required fields', () => {
      const result = nodeSchema.safeParse({ id: 'node-1' })
      expect(result.success).toBe(false)
    })

    it('rejects node with invalid position', () => {
      const result = nodeSchema.safeParse({
        id: 'node-1',
        type: 'block',
        position: { x: 'not-a-number', y: 0 },
        draggable: true,
        selectable: true,
        data: {},
      })
      expect(result.success).toBe(false)
    })
  })

  describe('edgeSchema', () => {
    it('validates a valid edge', () => {
      const result = edgeSchema.safeParse({
        id: 'edge-1',
        source: 'node-1',
        sourceHandle: 'h1',
        target: 'node-2',
        targetHandle: 'h2',
      })
      expect(result.success).toBe(true)
    })

    it('validates an edge with optional type', () => {
      const result = edgeSchema.safeParse({
        id: 'edge-1',
        source: 'node-1',
        sourceHandle: 'h1',
        target: 'node-2',
        targetHandle: 'h2',
        type: 'smoothstep',
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.type).toBe('smoothstep')
      }
    })

    it('rejects edge missing required fields', () => {
      const result = edgeSchema.safeParse({ id: 'edge-1' })
      expect(result.success).toBe(false)
    })
  })
})
