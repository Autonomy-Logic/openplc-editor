import {
  decodeHexAnchor,
  mapArduinoAnchorResult,
  mapRuntimeAnchorResult,
  selectAnchorSource,
} from '../device-anchor'

describe('selectAnchorSource', () => {
  it('maps websocket to runtime', () => {
    expect(selectAnchorSource('websocket')).toBe('runtime')
  })

  it.each(['tcp', 'rtu', 'simulator', 'anything'])('maps %s to arduino', (t) => {
    expect(selectAnchorSource(t)).toBe('arduino')
  })
})

describe('decodeHexAnchor', () => {
  it('decodes a plain hex string', () => {
    expect(decodeHexAnchor('0abc01')).toEqual([0x0a, 0xbc, 0x01])
  })

  it('tolerates 0x prefix and whitespace', () => {
    expect(decodeHexAnchor('  0xDEadBE ')).toEqual([0xde, 0xad, 0xbe])
  })

  it('returns [] for an empty string', () => {
    expect(decodeHexAnchor('')).toEqual([])
    expect(decodeHexAnchor('0x')).toEqual([])
  })

  it('returns null for odd length', () => {
    expect(decodeHexAnchor('abc')).toBeNull()
  })

  it('returns null for non-hex chars', () => {
    expect(decodeHexAnchor('zzzz')).toBeNull()
  })
})

describe('mapRuntimeAnchorResult', () => {
  it('maps a valid device_id', () => {
    expect(mapRuntimeAnchorResult('0ABC01')).toEqual({
      success: true,
      source: 'runtime',
      anchorHex: '0abc01',
      anchor: [0x0a, 0xbc, 0x01],
    })
  })

  it('errors when device_id is missing', () => {
    expect(mapRuntimeAnchorResult(undefined)).toEqual({
      success: false,
      source: 'runtime',
      error: 'Runtime returned no device_id',
    })
  })

  it('errors when device_id is blank', () => {
    const r = mapRuntimeAnchorResult('   ')
    expect(r.success).toBe(false)
    expect(r.source).toBe('runtime')
  })

  it('errors when device_id is malformed', () => {
    const r = mapRuntimeAnchorResult('xyz')
    expect(r.success).toBe(false)
    expect(r.error).toContain('malformed')
  })
})

describe('mapArduinoAnchorResult', () => {
  it('maps a successful board-id', () => {
    expect(
      mapArduinoAnchorResult({ success: true, boardId: new Uint8Array([0x01, 0x02]), boardIdHex: '0102' }),
    ).toEqual({ success: true, source: 'arduino', anchorHex: '0102', anchor: [0x01, 0x02] })
  })

  it('maps a successful board-id with no bytes (unsupported core)', () => {
    const r = mapArduinoAnchorResult({ success: true, boardIdHex: '' })
    expect(r).toEqual({ success: true, source: 'arduino', anchorHex: '', anchor: [] })
  })

  it('propagates the failure error', () => {
    expect(mapArduinoAnchorResult({ success: false, error: 'nope' })).toEqual({
      success: false,
      source: 'arduino',
      error: 'nope',
    })
  })
})
