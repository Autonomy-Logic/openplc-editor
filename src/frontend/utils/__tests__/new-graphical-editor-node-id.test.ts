import { newGraphicalEditorNodeID } from '../new-graphical-editor-node-id'

describe('newGraphicalEditorNodeID', () => {
  it('returns a string with default prefix NODE and underscore separator', () => {
    const id = newGraphicalEditorNodeID()
    expect(id).toMatch(/^NODE_/)
  })

  it('uses custom prefix uppercased', () => {
    const id = newGraphicalEditorNodeID('block')
    expect(id).toMatch(/^BLOCK_/)
  })

  it('uses custom separator', () => {
    const id = newGraphicalEditorNodeID('COIL', '-')
    expect(id).toMatch(/^COIL-/)
  })

  it('generates unique IDs on each call', () => {
    const id1 = newGraphicalEditorNodeID()
    const id2 = newGraphicalEditorNodeID()
    expect(id1).not.toBe(id2)
  })

  it('contains a UUID-like suffix', () => {
    const id = newGraphicalEditorNodeID()
    const suffix = id.replace(/^NODE_/, '')
    expect(suffix).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('falls back to uuidv4 when crypto.randomUUID is unavailable', () => {
    const originalRandomUUID = crypto.randomUUID.bind(crypto)
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true })

    try {
      const id = newGraphicalEditorNodeID('TEST')
      expect(id).toMatch(/^TEST_[0-9a-f]{8}-/)
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { value: originalRandomUUID, configurable: true })
    }
  })
})
