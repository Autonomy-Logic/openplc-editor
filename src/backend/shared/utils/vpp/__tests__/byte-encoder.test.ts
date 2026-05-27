import { bytesToHexString, encodeConfigBytes } from '../byte-encoder'

describe('encodeConfigBytes', () => {
  it('returns an empty array when no fields and no totalBytes are supplied', () => {
    expect(encodeConfigBytes([], {})).toEqual([])
  })

  it('pads to totalBytes when explicit', () => {
    expect(encodeConfigBytes([], {}, 4)).toEqual([0, 0, 0, 0])
  })

  it('writes a size-2 big-endian value verbatim', () => {
    const fields = [{ id: 'channels', encoding: { byteOffset: 0, size: 2 as const, endian: 'big' as const } }]
    expect(encodeConfigBytes(fields, { channels: '0x4003' })).toEqual([0x40, 0x03])
  })

  it('writes a size-2 little-endian value', () => {
    const fields = [{ id: 'x', encoding: { byteOffset: 0, size: 2 as const, endian: 'little' as const } }]
    expect(encodeConfigBytes(fields, { x: '0x1234' })).toEqual([0x34, 0x12])
  })

  it('defaults endian to big', () => {
    const fields = [{ id: 'x', encoding: { byteOffset: 0, size: 2 as const } }]
    expect(encodeConfigBytes(fields, { x: '0xABCD' })).toEqual([0xab, 0xcd])
  })

  it('writes a size-1 value at the requested offset', () => {
    const fields = [{ id: 'b', encoding: { byteOffset: 3, size: 1 as const } }]
    expect(encodeConfigBytes(fields, { b: 0x07 }, 5)).toEqual([0, 0, 0, 0x07, 0])
  })

  it('combines mask+base correctly (low nibble from value, upper bits from base)', () => {
    // base 0x2100, mask 0x000F. Value 0x5 -> (0x2100 & 0xFFF0) | (0x5 & 0xF) = 0x2105
    const fields = [
      {
        id: 'ch1_type',
        encoding: { byteOffset: 4, size: 2 as const, base: '0x2100', mask: '0x000F' },
      },
    ]
    expect(encodeConfigBytes(fields, { ch1_type: '0x5' }, 6)).toEqual([0, 0, 0, 0, 0x21, 0x05])
  })

  it('treats only-mask-or-only-base as no mask/base (and warns)', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const fields = [{ id: 'x', encoding: { byteOffset: 0, size: 2 as const, mask: '0x000F' } }]
    expect(encodeConfigBytes(fields, { x: '0xABCD' })).toEqual([0xab, 0xcd])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('parses decimal strings as decimal', () => {
    const fields = [{ id: 'n', encoding: { byteOffset: 0, size: 1 as const } }]
    expect(encodeConfigBytes(fields, { n: '15' }, 1)).toEqual([15])
  })

  it('coerces booleans to 0/1', () => {
    const fields = [
      { id: 't', encoding: { byteOffset: 0, size: 1 as const } },
      { id: 'f', encoding: { byteOffset: 1, size: 1 as const } },
    ]
    expect(encodeConfigBytes(fields, { t: true, f: false }, 2)).toEqual([1, 0])
  })

  it('skips fields with undefined / null / empty-string values', () => {
    const fields = [
      { id: 'a', encoding: { byteOffset: 0, size: 1 as const } },
      { id: 'b', encoding: { byteOffset: 1, size: 1 as const } },
      { id: 'c', encoding: { byteOffset: 2, size: 1 as const } },
    ]
    expect(encodeConfigBytes(fields, { a: undefined, b: null as unknown as undefined, c: '' }, 3)).toEqual([0, 0, 0])
  })

  it('skips non-finite numeric values', () => {
    const fields = [{ id: 'x', encoding: { byteOffset: 0, size: 1 as const } }]
    expect(encodeConfigBytes(fields, { x: Number.NaN }, 1)).toEqual([0])
    expect(encodeConfigBytes(fields, { x: Number.POSITIVE_INFINITY }, 1)).toEqual([0])
  })

  it('skips fields that fail numeric parsing', () => {
    const fields = [{ id: 'x', encoding: { byteOffset: 0, size: 1 as const } }]
    expect(encodeConfigBytes(fields, { x: 'not-a-number' }, 1)).toEqual([0])
  })

  it('handles whitespace-only strings as missing', () => {
    const fields = [{ id: 'x', encoding: { byteOffset: 0, size: 1 as const } }]
    expect(encodeConfigBytes(fields, { x: '   ' }, 1)).toEqual([0])
  })

  it('ignores fields whose encoding is missing or malformed', () => {
    const fields = [
      { id: 'a' },
      { id: 'b', encoding: null as unknown as undefined },
      { id: 'c', encoding: { byteOffset: 0 } as unknown },
      { id: 'd', encoding: { size: 1 } as unknown },
      { id: 'e', encoding: { byteOffset: 0, size: 3 } as unknown },
    ]
    expect(encodeConfigBytes(fields, { a: '1', b: '2', c: '3', d: '4', e: '5' })).toEqual([])
  })

  it('clips writes that fall outside totalBytes (size 1 and size 2)', () => {
    const fields = [
      { id: 'b1', encoding: { byteOffset: 5, size: 1 as const } },
      { id: 'b2', encoding: { byteOffset: 3, size: 2 as const, endian: 'big' as const } },
      { id: 'b3', encoding: { byteOffset: 3, size: 2 as const, endian: 'little' as const } },
    ]
    // totalBytes = 4: byte at offset 5 is clipped. offset 3..4 partially clipped (only [3] written).
    expect(encodeConfigBytes(fields, { b1: 0xff, b2: '0xAABB', b3: '0xAABB' }, 4)).toEqual([0, 0, 0, 0xbb])
  })

  it('handles negative byte offsets by ignoring them', () => {
    const fields = [
      { id: 'a', encoding: { byteOffset: -1, size: 1 as const } },
      { id: 'b', encoding: { byteOffset: -2, size: 2 as const } },
    ]
    expect(encodeConfigBytes(fields, { a: 0xff, b: 0xffff }, 2)).toEqual([0, 0])
  })

  it('truncates oversized values to the field size', () => {
    const fields = [
      { id: 'big', encoding: { byteOffset: 0, size: 1 as const } },
      { id: 'huge', encoding: { byteOffset: 1, size: 2 as const, endian: 'big' as const } },
    ]
    expect(encodeConfigBytes(fields, { big: 0xabcd, huge: 0xfeedface }, 3)).toEqual([0xcd, 0xfa, 0xce])
  })

  it('computes totalBytes from field offsets when omitted', () => {
    const fields = [
      { id: 'a', encoding: { byteOffset: 0, size: 2 as const } },
      { id: 'b', encoding: { byteOffset: 5, size: 1 as const } },
    ]
    expect(encodeConfigBytes(fields, { a: '0x1234', b: '0xFF' })).toEqual([0x12, 0x34, 0, 0, 0, 0xff])
  })

  it('does not shrink computed totalBytes when a later field ends earlier', () => {
    // Field "big" pushes max to 8. Field "small" ends at 2 — must NOT
    // overwrite max. Exercises the false branch of `end > max`.
    const fields = [
      { id: 'big', encoding: { byteOffset: 6, size: 2 as const } },
      { id: 'small', encoding: { byteOffset: 0, size: 2 as const } },
    ]
    expect(encodeConfigBytes(fields, { big: '0xAABB', small: '0x1234' })).toEqual([0x12, 0x34, 0, 0, 0, 0, 0xaa, 0xbb])
  })

  it('skips malformed-encoding fields while still encoding valid ones in the same call', () => {
    // Mixes a valid field (so length > 0) with two malformed ones — the
    // malformed ones must be silently skipped without affecting the output.
    const fields = [
      { id: 'good', encoding: { byteOffset: 0, size: 2 as const } },
      { id: 'no_size', encoding: { byteOffset: 0 } as unknown },
      { id: 'no_offset', encoding: { size: 1 } as unknown },
    ]
    expect(encodeConfigBytes(fields, { good: '0x4003', no_size: '0xFF', no_offset: '0xFF' })).toEqual([0x40, 0x03])
  })

  it('falls back to 0 when mask or base is not a valid number', () => {
    // mask "garbage" -> 0; base "garbage" -> 0. Result: (0 & ~0) | (raw & 0) = 0.
    const fields = [
      {
        id: 'x',
        encoding: { byteOffset: 0, size: 2 as const, mask: 'garbage', base: 'garbage' },
      },
    ]
    expect(encodeConfigBytes(fields, { x: '0x1234' }, 2)).toEqual([0, 0])
  })

  it('clips a little-endian write whose first byte is past the end', () => {
    // off0 = 4 (>= totalBytes), off1 = 5 (>= totalBytes). Nothing written.
    const fields = [{ id: 'b', encoding: { byteOffset: 4, size: 2 as const, endian: 'little' as const } }]
    expect(encodeConfigBytes(fields, { b: '0xAABB' }, 4)).toEqual([0, 0, 0, 0])
  })

  it('matches the SLM-THM-4 factory default (all 4 channels, low burnout/F, type J everywhere)', () => {
    const fields = [
      { id: 'channels_enabled', encoding: { byteOffset: 0, size: 2 as const, endian: 'big' as const } },
      { id: 'burnout_units', encoding: { byteOffset: 2, size: 2 as const, endian: 'big' as const } },
      {
        id: 'ch1_type',
        encoding: { byteOffset: 4, size: 2 as const, endian: 'big' as const, base: '0x2100', mask: '0x000F' },
      },
      {
        id: 'ch2_type',
        encoding: { byteOffset: 6, size: 2 as const, endian: 'big' as const, base: '0x2200', mask: '0x000F' },
      },
      {
        id: 'ch3_type',
        encoding: { byteOffset: 8, size: 2 as const, endian: 'big' as const, base: '0x2300', mask: '0x000F' },
      },
      {
        id: 'ch4_type',
        encoding: { byteOffset: 10, size: 2 as const, endian: 'big' as const, base: '0x2400', mask: '0x000F' },
      },
    ]
    const values = {
      channels_enabled: '0x4003',
      burnout_units: '0x6005',
      ch1_type: '0x0',
      ch2_type: '0x0',
      ch3_type: '0x0',
      ch4_type: '0x0',
    }
    expect(encodeConfigBytes(fields, values, 20)).toEqual([
      0x40, 0x03, 0x60, 0x05, 0x21, 0x00, 0x22, 0x00, 0x23, 0x00, 0x24, 0x00, 0, 0, 0, 0, 0, 0, 0, 0,
    ])
  })
})

describe('bytesToHexString', () => {
  it('formats bytes as space-separated upper-case hex', () => {
    expect(bytesToHexString([0x40, 0x03, 0x60, 0x05])).toBe('40 03 60 05')
  })

  it('zero-pads each byte to two characters', () => {
    expect(bytesToHexString([0, 1, 0xff])).toBe('00 01 FF')
  })

  it('masks values to a single byte', () => {
    expect(bytesToHexString([0x1ff, 0x200])).toBe('FF 00')
  })

  it('returns an empty string for an empty array', () => {
    expect(bytesToHexString([])).toBe('')
  })
})
