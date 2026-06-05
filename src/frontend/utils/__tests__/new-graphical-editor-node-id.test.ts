import { newGraphicalEditorNodeID } from '../new-graphical-editor-node-id'

describe('newGraphicalEditorNodeID', () => {
  it('generates ID with default prefix and separator using crypto.randomUUID', () => {
    const id = newGraphicalEditorNodeID()
    expect(id).toMatch(/^NODE_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('uses custom prefix uppercased and custom separator', () => {
    const id = newGraphicalEditorNodeID('block', '-')
    expect(id).toMatch(/^BLOCK-/)
  })

  it('falls back to uuidv4 when crypto.randomUUID is unavailable', () => {
    const orig = crypto.randomUUID.bind(crypto)
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true })
    try {
      expect(newGraphicalEditorNodeID('TEST')).toMatch(/^TEST_[0-9a-f]{8}-/)
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { value: orig, configurable: true })
    }
  })
})
