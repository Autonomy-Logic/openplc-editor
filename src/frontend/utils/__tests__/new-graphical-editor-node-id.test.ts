import { newGraphicalEditorNodeID } from '../new-graphical-editor-node-id'

describe('newGraphicalEditorNodeID', () => {
  it('generates ID with default prefix and separator', () => {
    const id = newGraphicalEditorNodeID()
    expect(id).toMatch(/^NODE_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('uses custom prefix uppercased and custom separator', () => {
    const id = newGraphicalEditorNodeID('block', '-')
    expect(id).toMatch(/^BLOCK-/)
  })

  it('does not repeat itself across calls', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newGraphicalEditorNodeID()))
    expect(ids.size).toBe(50)
  })
})
