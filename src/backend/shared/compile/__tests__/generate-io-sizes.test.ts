import { clampIoSizes, completeIoSizes, generateIoSizesHeader, type IoSizes } from '../steps/generate-io-sizes'

/** The large set `openplc.h` compiles for everything that is not a small AVR. */
const DEFAULTS: IoSizes = {
  digitalInput: 56,
  digitalOutput: 56,
  analogInput: 32,
  analogOutput: 32,
  memoryWord: 20,
  memoryDword: 20,
  memoryLword: 20,
}

describe('completeIoSizes', () => {
  it('returns null when the board declares no io block at all', () => {
    expect(completeIoSizes(undefined)).toBeNull()
  })

  it('returns the sizes when every field is declared', () => {
    expect(completeIoSizes(DEFAULTS)).toEqual(DEFAULTS)
  })

  it('rejects a partial block rather than filling the gaps', () => {
    // Clamping against an undefined default yields NaN, which compares unequal
    // to everything and emits an override for a macro nobody asked to change.
    const { memoryLword: _dropped, ...partial } = DEFAULTS
    expect(completeIoSizes(partial)).toBeNull()
  })

  it('rejects a non-finite count', () => {
    expect(completeIoSizes({ ...DEFAULTS, analogInput: Number.NaN })).toBeNull()
  })
})

describe('clampIoSizes', () => {
  it('returns the board defaults when the project asked for nothing', () => {
    expect(clampIoSizes(undefined, DEFAULTS)).toEqual(DEFAULTS)
    expect(clampIoSizes({}, DEFAULTS)).toEqual(DEFAULTS)
  })

  it('raises a count the project asked to grow, up to the board ceiling', () => {
    const sizes = clampIoSizes({ digitalOutput: 256 }, DEFAULTS, { digitalOutput: 512 })
    expect(sizes.digitalOutput).toBe(256)
    // Untouched fields stay at the default.
    expect(sizes.digitalInput).toBe(56)
  })

  it('caps a request above the board ceiling', () => {
    expect(clampIoSizes({ digitalOutput: 4096 }, DEFAULTS, { digitalOutput: 512 }).digitalOutput).toBe(512)
  })

  it('refuses to go below the board default', () => {
    // These macros also dimension the IEC pointer arrays, and mapEmptyBuffers()
    // aliases %MW/%MD/%ML into the Modbus banks. Shrinking a segment below what
    // a compiled program addresses drops I/O with no diagnostic anywhere, so
    // growth is the only direction offered.
    expect(clampIoSizes({ digitalOutput: 8 }, DEFAULTS).digitalOutput).toBe(56)
  })

  it('treats a board that declares no ceiling as "default is the ceiling"', () => {
    // A package that has not said how much room the board has is not a licence
    // to fill an AVR's SRAM.
    expect(clampIoSizes({ digitalOutput: 512 }, DEFAULTS).digitalOutput).toBe(56)
  })

  it('never exceeds the 16-bit Modbus address space', () => {
    expect(clampIoSizes({ digitalOutput: 999999 }, DEFAULTS, { digitalOutput: 999999 }).digitalOutput).toBe(65535)
  })

  it('ignores non-numeric and non-finite requests', () => {
    const sizes = clampIoSizes({ digitalOutput: Number.NaN, analogInput: Number.POSITIVE_INFINITY }, DEFAULTS, {
      digitalOutput: 512,
      analogInput: 512,
    })
    expect(sizes.digitalOutput).toBe(56)
    expect(sizes.analogInput).toBe(32)
  })

  it('truncates a fractional request rather than emitting a fractional macro', () => {
    expect(clampIoSizes({ memoryWord: 40.9 }, DEFAULTS, { memoryWord: 512 }).memoryWord).toBe(40)
  })
})

describe('generateIoSizesHeader', () => {
  it('emits nothing when every size is the board default', () => {
    // A project that never touched the setting must compile byte-for-byte as
    // it did, so no file is written at all.
    expect(generateIoSizesHeader(DEFAULTS, DEFAULTS)).toBeNull()
  })

  it('emits only the macros that differ', () => {
    const header = generateIoSizesHeader({ ...DEFAULTS, digitalOutput: 256, memoryWord: 64 }, DEFAULTS)
    expect(header).toContain('#define MAX_DIGITAL_OUTPUT 256')
    expect(header).toContain('#define MAX_MEMORY_WORD 64')
    expect(header).not.toContain('MAX_DIGITAL_INPUT')
    expect(header).not.toContain('MAX_ANALOG_INPUT')
  })

  it('carries an include guard', () => {
    // Unlike defines.h, this reaches ~20 HAL translation units through
    // openplc.h, so it has to tolerate being seen many times.
    const header = generateIoSizesHeader({ ...DEFAULTS, analogOutput: 64 }, DEFAULTS) ?? ''
    expect(header).toContain('#ifndef OPENPLC_IO_SIZES_H')
    expect(header).toContain('#define OPENPLC_IO_SIZES_H')
    expect(header.trimEnd().endsWith('#endif')).toBe(true)
  })

  it('ends with a trailing newline so callers can concatenate', () => {
    expect(generateIoSizesHeader({ ...DEFAULTS, analogOutput: 64 }, DEFAULTS)?.endsWith('\n')).toBe(true)
  })

  it('emits macros in the order openplc.h declares them', () => {
    const header = generateIoSizesHeader(
      { ...DEFAULTS, memoryLword: 40, digitalInput: 64, analogOutput: 64 },
      DEFAULTS,
    ) as string
    const order = ['MAX_DIGITAL_INPUT', 'MAX_ANALOG_OUTPUT', 'MAX_MEMORY_LWORD']
    const positions = order.map((macro) => header.indexOf(macro))
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })
})
