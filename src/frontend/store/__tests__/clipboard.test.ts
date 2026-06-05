import { clipboardSchema } from '../slices/clipboard/types'

describe('clipboardSchema', () => {
  it('parses a valid fbd clipboard entry', () => {
    const result = clipboardSchema.safeParse({
      language: 'fbd',
      content: { nodes: [], edges: [] },
    })
    expect(result.success).toBe(true)
  })

  it('parses a valid ld clipboard entry', () => {
    const result = clipboardSchema.safeParse({
      language: 'ld',
      content: 'some ladder content',
    })
    expect(result.success).toBe(true)
  })

  it('parses a valid st clipboard entry', () => {
    const result = clipboardSchema.safeParse({
      language: 'st',
      content: { src: 'x := 1;' },
    })
    expect(result.success).toBe(true)
  })

  it('parses st with optional width/height', () => {
    const result = clipboardSchema.safeParse({
      language: 'st',
      content: { src: 'x := 1;', width: 100, height: 200 },
    })
    expect(result.success).toBe(true)
  })

  it('parses il, sfc, and other languages', () => {
    for (const language of ['il', 'sfc', 'other'] as const) {
      const result = clipboardSchema.safeParse({ language, content: 'data' })
      expect(result.success).toBe(true)
    }
  })

  it('rejects an invalid language', () => {
    const result = clipboardSchema.safeParse({ language: 'invalid', content: '' })
    expect(result.success).toBe(false)
  })
})
