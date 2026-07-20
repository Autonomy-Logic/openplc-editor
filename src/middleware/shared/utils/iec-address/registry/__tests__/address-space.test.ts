import { formatAddress, isBitClass, isIecAddress, parseAddress, prefixOf } from '../address-space'
import type { AddressClass } from '../types'

describe('address-space', () => {
  describe('prefixOf / isBitClass', () => {
    it('builds the prefix from direction + size', () => {
      expect(prefixOf({ direction: 'I', size: 'X' })).toBe('%IX')
      expect(prefixOf({ direction: 'Q', size: 'W' })).toBe('%QW')
      expect(prefixOf({ direction: 'M', size: 'D' })).toBe('%MD')
    })

    it('flags only X as a bit class', () => {
      expect(isBitClass({ direction: 'I', size: 'X' })).toBe(true)
      expect(isBitClass({ direction: 'Q', size: 'B' })).toBe(false)
      expect(isBitClass({ direction: 'I', size: 'W' })).toBe(false)
    })
  })

  describe('formatAddress', () => {
    it('formats bit classes as byte.bit', () => {
      const cls: AddressClass = { direction: 'I', size: 'X' }
      expect(formatAddress(cls, 0)).toBe('%IX0.0')
      expect(formatAddress(cls, 7)).toBe('%IX0.7')
      expect(formatAddress(cls, 8)).toBe('%IX1.0')
      expect(formatAddress(cls, 11)).toBe('%IX1.3')
    })

    it('formats non-bit classes as a flat index', () => {
      expect(formatAddress({ direction: 'Q', size: 'W' }, 0)).toBe('%QW0')
      expect(formatAddress({ direction: 'Q', size: 'W' }, 5)).toBe('%QW5')
      expect(formatAddress({ direction: 'M', size: 'B' }, 3)).toBe('%MB3')
    })
  })

  describe('parseAddress', () => {
    it('parses bit addresses to linear byte*8+bit', () => {
      expect(parseAddress('%IX0.0')).toEqual({ cls: { direction: 'I', size: 'X' }, linear: 0 })
      expect(parseAddress('%QX1.3')).toEqual({ cls: { direction: 'Q', size: 'X' }, linear: 11 })
      expect(parseAddress('%MX2.5')).toEqual({ cls: { direction: 'M', size: 'X' }, linear: 21 })
    })

    it('parses word/byte/dword/lword addresses', () => {
      expect(parseAddress('%IW3')).toEqual({ cls: { direction: 'I', size: 'W' }, linear: 3 })
      expect(parseAddress('%QB7')).toEqual({ cls: { direction: 'Q', size: 'B' }, linear: 7 })
      expect(parseAddress('%MD1')).toEqual({ cls: { direction: 'M', size: 'D' }, linear: 1 })
      expect(parseAddress('%IL9')).toEqual({ cls: { direction: 'I', size: 'L' }, linear: 9 })
    })

    it('returns null for non-addresses', () => {
      expect(parseAddress('')).toBeNull()
      expect(parseAddress('push_button')).toBeNull()
      expect(parseAddress('%ZZ0')).toBeNull()
      expect(parseAddress('%IX0')).toBeNull() // bit needs .bit
      expect(parseAddress('%IW')).toBeNull()
    })
  })

  describe('isIecAddress', () => {
    it('is true only for valid addresses', () => {
      expect(isIecAddress('%QX0.1')).toBe(true)
      expect(isIecAddress('%IW4')).toBe(true)
      expect(isIecAddress('relay')).toBe(false)
      expect(isIecAddress('')).toBe(false)
    })
  })
})
