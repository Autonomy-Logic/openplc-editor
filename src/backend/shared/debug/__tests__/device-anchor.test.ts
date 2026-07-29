import { mapArduinoAnchorResult, selectAnchorSource } from '../device-anchor'

describe('selectAnchorSource', () => {
  it('maps websocket to runtime', () => {
    expect(selectAnchorSource('websocket')).toBe('runtime')
  })

  it.each(['tcp', 'rtu', 'simulator', 'anything'])('maps %s to arduino', (t) => {
    expect(selectAnchorSource(t)).toBe('arduino')
  })
})

describe('mapArduinoAnchorResult', () => {
  it('maps a successful board-id (default arduino source)', () => {
    expect(
      mapArduinoAnchorResult({ success: true, boardId: new Uint8Array([0x01, 0x02]), boardIdHex: '0102' }),
    ).toEqual({ success: true, source: 'arduino', anchorHex: '0102', anchor: [0x01, 0x02] })
  })

  it('labels the source when given (runtime target, same raw bytes)', () => {
    expect(
      mapArduinoAnchorResult({ success: true, boardId: new Uint8Array([0xab]), boardIdHex: 'ab' }, 'runtime'),
    ).toEqual({ success: true, source: 'runtime', anchorHex: 'ab', anchor: [0xab] })
  })

  it('maps a successful board-id with no bytes (unsupported core)', () => {
    const r = mapArduinoAnchorResult({ success: true, boardIdHex: '' })
    expect(r).toEqual({ success: true, source: 'arduino', anchorHex: '', anchor: [] })
  })

  it('propagates the failure error (with the given source)', () => {
    expect(mapArduinoAnchorResult({ success: false, error: 'nope' }, 'runtime')).toEqual({
      success: false,
      source: 'runtime',
      error: 'nope',
    })
  })
})
