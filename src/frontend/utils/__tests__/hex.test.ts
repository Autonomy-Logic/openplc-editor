import { bytesToHex, bytesToHexSpaced, hexToBytes } from '../hex'

describe('hexToBytes', () => {
  it('converts a hex string to Uint8Array', () => {
    const result = hexToBytes('0a1bff')
    expect(result).toEqual(new Uint8Array([0x0a, 0x1b, 0xff]))
  })

  it('handles an empty string', () => {
    expect(hexToBytes('')).toEqual(new Uint8Array([]))
  })

  it('handles uppercase hex', () => {
    expect(hexToBytes('FF00')).toEqual(new Uint8Array([0xff, 0x00]))
  })

  it('strips whitespace before converting', () => {
    expect(hexToBytes('0a 1b ff')).toEqual(new Uint8Array([0x0a, 0x1b, 0xff]))
  })

  it('strips tabs and newlines', () => {
    expect(hexToBytes('0a\t1b\nff')).toEqual(new Uint8Array([0x0a, 0x1b, 0xff]))
  })
})

describe('bytesToHex', () => {
  it('converts Uint8Array to compact lowercase hex', () => {
    expect(bytesToHex(new Uint8Array([0x0a, 0x1b, 0xff]))).toBe('0a1bff')
  })

  it('pads single-digit values with leading zero', () => {
    expect(bytesToHex(new Uint8Array([0x00, 0x01]))).toBe('0001')
  })

  it('returns empty string for empty array', () => {
    expect(bytesToHex(new Uint8Array([]))).toBe('')
  })
})

describe('bytesToHexSpaced', () => {
  it('converts Uint8Array to space-separated uppercase hex', () => {
    expect(bytesToHexSpaced(new Uint8Array([0x0a, 0x1b, 0xff]))).toBe('0A 1B FF')
  })

  it('pads single-digit values with leading zero', () => {
    expect(bytesToHexSpaced(new Uint8Array([0x00, 0x05]))).toBe('00 05')
  })

  it('returns empty string for empty array', () => {
    expect(bytesToHexSpaced(new Uint8Array([]))).toBe('')
  })
})
