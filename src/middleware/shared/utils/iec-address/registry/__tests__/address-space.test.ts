import { formatAddress, isBitClass, isIecAddress, parseAddress, prefixOf, slotRangesOverlap } from '../address-space'
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

  // An ARRAY at a physical address occupies one slot PER ELEMENT, laid out
  // consecutively (openplc-editor#565), so "do these two collide" stops being
  // a string comparison and becomes a range question.
  describe('slotRangesOverlap', () => {
    /** Non-null parse, so the tests read as addresses rather than as guards. */
    const at = (address: string) => {
      const parsed = parseAddress(address)
      if (!parsed) throw new Error(`not an address: ${address}`)
      return parsed
    }

    it('detects a scalar landing inside an array', () => {
      // The case from the issue discussion: ARRAY [0..9] OF BOOL at %QX0.0
      // covers %QX0.0-%QX1.1, so a BOOL at %QX0.6 is inside it — and the two
      // address strings are different, which is why equality missed it.
      expect(slotRangesOverlap(at('%QX0.0'), 10, at('%QX0.6'), 1)).toBe(true)
      expect(slotRangesOverlap(at('%QX0.6'), 1, at('%QX0.0'), 10)).toBe(true)
    })

    it('lets a scalar sit immediately past the end of an array', () => {
      // %MW0 + 4 slots ends at %MW3.
      expect(slotRangesOverlap(at('%MW0'), 4, at('%MW3'), 1)).toBe(true)
      expect(slotRangesOverlap(at('%MW0'), 4, at('%MW4'), 1)).toBe(false)
    })

    it('detects two arrays that straddle each other', () => {
      expect(slotRangesOverlap(at('%IW0'), 4, at('%IW3'), 4)).toBe(true)
      expect(slotRangesOverlap(at('%IW0'), 4, at('%IW4'), 4)).toBe(false)
    })

    it('walks bit ranges across the byte boundary', () => {
      // %QX0.6 + 4 slots -> %QX0.6, %QX0.7, %QX1.0, %QX1.1.
      expect(slotRangesOverlap(at('%QX0.6'), 4, at('%QX1.1'), 1)).toBe(true)
      expect(slotRangesOverlap(at('%QX0.6'), 4, at('%QX1.2'), 1)).toBe(false)
    })

    it('never collides across classes — each prefix is its own space', () => {
      // %MW0 and %MD0 index different runtime arrays; same index, unrelated
      // storage. Direction separates %IW0 from %QW0 for the same reason.
      expect(slotRangesOverlap(at('%MW0'), 8, at('%MD0'), 8)).toBe(false)
      expect(slotRangesOverlap(at('%IW0'), 8, at('%QW0'), 8)).toBe(false)
    })

    it('reads a slot count below 1 as 1', () => {
      // getArrayTotalElements answers 0 for a shape it cannot read. Claiming
      // nothing would make a malformed array collide with nobody; it must
      // still hold the address it names.
      expect(slotRangesOverlap(at('%MW5'), 0, at('%MW5'), 1)).toBe(true)
      expect(slotRangesOverlap(at('%MW5'), 0, at('%MW6'), 1)).toBe(false)
    })
  })
})
