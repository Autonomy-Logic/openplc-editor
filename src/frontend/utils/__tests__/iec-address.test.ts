import { generateIecAddress } from '../iec-address'

describe('generateIecAddress', () => {
  describe('word addressing', () => {
    it('returns the prefix + 0 when nothing is used', () => {
      expect(generateIecAddress('%IW', false, new Set())).toBe('%IW0')
    })

    it('skips claimed addresses and picks the first free one', () => {
      const used = new Set(['%IW0', '%IW1', '%IW3'])
      expect(generateIecAddress('%IW', false, used)).toBe('%IW2')
    })

    it('picks the next index after the highest claimed when no gaps exist', () => {
      const used = new Set(['%IW0', '%IW1', '%IW2', '%IW3'])
      expect(generateIecAddress('%IW', false, used)).toBe('%IW4')
    })

    it('honours startFrom for skipping a known floor', () => {
      expect(generateIecAddress('%IW', false, new Set(), 100)).toBe('%IW100')
    })

    it('still skips claimed addresses past startFrom', () => {
      const used = new Set(['%IW100', '%IW101'])
      expect(generateIecAddress('%IW', false, used, 100)).toBe('%IW102')
    })

    it('treats startFrom = 0 as the explicit floor', () => {
      // The util treats `startFrom ?? 0` so `0` and `undefined` differ
      // only if explicitly distinguished — both should yield 0.
      expect(generateIecAddress('%IW', false, new Set(), 0)).toBe('%IW0')
    })

    it('works with output prefix', () => {
      expect(generateIecAddress('%QW', false, new Set(['%QW0']))).toBe('%QW1')
    })
  })

  describe('bit addressing', () => {
    it('returns prefix + byte.bit format', () => {
      expect(generateIecAddress('%IX', true, new Set())).toBe('%IX0.0')
    })

    it('walks bits within a byte before incrementing the byte', () => {
      const used = new Set(['%IX0.0'])
      expect(generateIecAddress('%IX', true, used)).toBe('%IX0.1')
    })

    it('rolls over to the next byte after bit 7', () => {
      const used = new Set([
        '%IX0.0',
        '%IX0.1',
        '%IX0.2',
        '%IX0.3',
        '%IX0.4',
        '%IX0.5',
        '%IX0.6',
        '%IX0.7',
      ])
      expect(generateIecAddress('%IX', true, used)).toBe('%IX1.0')
    })

    it('finds the first free bit in a partially-claimed byte', () => {
      const used = new Set(['%IX0.0', '%IX0.1', '%IX0.2', '%IX0.4', '%IX0.5', '%IX0.6', '%IX0.7'])
      expect(generateIecAddress('%IX', true, used)).toBe('%IX0.3')
    })

    it('respects startFrom in linear-bit space', () => {
      // startFrom=8 should land on the start of byte 1.
      expect(generateIecAddress('%IX', true, new Set(), 8)).toBe('%IX1.0')
    })

    it('handles a fully-claimed first byte and the start of the second', () => {
      const used = new Set([
        '%IX0.0',
        '%IX0.1',
        '%IX0.2',
        '%IX0.3',
        '%IX0.4',
        '%IX0.5',
        '%IX0.6',
        '%IX0.7',
        '%IX1.0',
      ])
      expect(generateIecAddress('%IX', true, used)).toBe('%IX1.1')
    })

    it('works with output bit prefix', () => {
      expect(generateIecAddress('%QX', true, new Set(['%QX0.0', '%QX0.1']))).toBe('%QX0.2')
    })
  })
})
