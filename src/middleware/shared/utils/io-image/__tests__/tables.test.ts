/**
 * The canonical table list, pinned (DOPE-615, B1).
 *
 * This list is the single source for five things that used to be written out
 * separately: the two area sets, the `image.conf` keys and units, the
 * bare-metal macros, and the S7comm buffer enumeration. That makes it worth
 * pinning hard — a change here moves all five at once, which is the point,
 * and should therefore be deliberate rather than incidental.
 *
 * The other half of the contract lives in the runtime repository, whose own
 * pytest reads the C sources and checks the enum, the key array, the struct
 * fields and the units against its Python list. Neither repository can import
 * the other, so both hold the same order for the same stated reason: the
 * declaration order of `core/src/plc_app/image_tables.h`.
 */

import {
  extentForDataBlock,
  IMAGE_AREAS_BAREMETAL,
  IMAGE_AREAS_RUNTIME_V4,
  IMAGE_TABLES,
  tableForKey,
} from '../tables'

describe('IMAGE_TABLES', () => {
  it('lists the fourteen tables in the header declaration order', () => {
    // Pinned as a literal rather than derived: the whole value of this list is
    // that the order is the header's, and deriving the expectation from the
    // list would agree with itself no matter what happened to it.
    expect(IMAGE_TABLES.map((table) => table.key)).toEqual([
      'bool_input',
      'bool_output',
      'byte_input',
      'byte_output',
      'int_input',
      'int_output',
      'dint_input',
      'dint_output',
      'lint_input',
      'lint_output',
      'int_memory',
      'dint_memory',
      'lint_memory',
      'bool_memory',
    ])
  })

  it('has no byte-addressed memory table', () => {
    // Not an oversight to be tidied: the runtime declares byte_input and
    // byte_output but no byte_memory, so `%MB` has no storage anywhere.
    expect(IMAGE_TABLES.map((table) => table.key)).not.toContain('byte_memory')
    expect(tableForKey('byte_memory')).toBeUndefined()
  })

  it('gives every table exactly one prefix, and every prefix one table', () => {
    const prefixes = IMAGE_TABLES.map((table) => table.prefix)
    expect(new Set(prefixes).size).toBe(prefixes.length)
    for (const table of IMAGE_TABLES) {
      expect(tableForKey(table.key)).toBe(table)
    }
  })

  it('counts only the BOOL tables in bits', () => {
    // The three whose storage unit and address unit differ, which is the one
    // place a factor of eight can hide.
    const inBits = IMAGE_TABLES.filter((table) => table.unit === 'bits').map((t) => t.key)
    expect(inBits).toEqual(['bool_input', 'bool_output', 'bool_memory'])
  })

  it('pairs each unit with the width its prefix addresses', () => {
    const expected: Record<string, string> = {
      X: 'bits',
      B: 'bytes',
      W: 'words',
      D: 'dwords',
      L: 'lwords',
    }
    for (const table of IMAGE_TABLES) {
      expect(table.unit).toBe(expected[table.prefix.charAt(2)])
    }
  })
})

describe('the area sets derived from it', () => {
  it('gives Runtime v4 every table', () => {
    expect(IMAGE_AREAS_RUNTIME_V4.size).toBe(IMAGE_TABLES.length)
  })

  it('gives bare metal only the areas it declares a buffer for', () => {
    expect([...IMAGE_AREAS_BAREMETAL].sort()).toEqual(
      ['%ID', '%IW', '%IX', '%MD', '%ML', '%MW', '%QD', '%QW', '%QX'].sort(),
    )
  })

  it('withholds from bare metal exactly the areas with no macro', () => {
    // %MX is the one that matters: bare metal has no bool_memory, which is why
    // a `%MX` declaration there is reported rather than silently dropped.
    const withoutMacro = IMAGE_TABLES.filter((t) => !t.macro).map((t) => t.prefix)
    expect(withoutMacro).toEqual(['%IB', '%QB', '%IL', '%QL', '%MX'])
    for (const prefix of withoutMacro) {
      expect(IMAGE_AREAS_BAREMETAL.has(prefix)).toBe(false)
      expect(IMAGE_AREAS_RUNTIME_V4.has(prefix)).toBe(true)
    }
  })

  it('emits the bare-metal macros in the order defines.h already used', () => {
    // Filtering the canonical list must not move any macro, or every firmware
    // rebuilds for a reordering that means nothing.
    expect(IMAGE_TABLES.filter((t) => t.macro).map((t) => t.macro)).toEqual([
      'MAX_DIGITAL_INPUT',
      'MAX_DIGITAL_OUTPUT',
      'MAX_ANALOG_INPUT',
      'MAX_ANALOG_OUTPUT',
      'MAX_REAL_INPUT',
      'MAX_REAL_OUTPUT',
      'MAX_MEMORY_WORD',
      'MAX_MEMORY_DWORD',
      'MAX_MEMORY_LWORD',
    ])
  })
})


describe('extentForDataBlock', () => {
  // Asserted from BOTH directions, because the two conversions inside it pull
  // opposite ways and a single-direction test passes with either one inverted.

  it('turns wire bytes into elements: 128 bytes of a word table is 64 words', () => {
    expect(extentForDataBlock({ unit: 'words' }, 0, 128).end).toBe(64)
  })

  it('and the other way: 64 words of a word table is 128 bytes on the wire', () => {
    // The inverse, stated as the size a block must declare to reach 64 words.
    expect(extentForDataBlock({ unit: 'words' }, 0, 64 * 2).end).toBe(64)
    expect(extentForDataBlock({ unit: 'words' }, 0, 63 * 2).end).toBe(63)
  })

  it('converts each width by its own byte count', () => {
    expect(extentForDataBlock({ unit: 'bytes' }, 0, 8).end).toBe(8)
    expect(extentForDataBlock({ unit: 'words' }, 0, 8).end).toBe(4)
    expect(extentForDataBlock({ unit: 'dwords' }, 0, 8).end).toBe(2)
    expect(extentForDataBlock({ unit: 'lwords' }, 0, 8).end).toBe(1)
  })

  it('drops a partial element rather than rounding it up', () => {
    // Three bytes of a word table is one addressable word. Rounding up would
    // size storage for a word the block does not actually carry.
    expect(extentForDataBlock({ unit: 'words' }, 0, 3).end).toBe(1)
    expect(extentForDataBlock({ unit: 'lwords' }, 0, 7).end).toBe(0)
  })

  it('reports a BOOL block in bits while taking its start in elements', () => {
    // The one table where the two units differ. A block at element 2, four
    // bytes long, covers bytes 2..5 — bits 16..47 — so it needs 48 bits.
    expect(extentForDataBlock({ unit: 'bits' }, 2, 4).end).toBe(48)
    expect(extentForDataBlock({ unit: 'bits' }, 0, 1).end).toBe(8)
  })

  it('and the other way for BOOL: 48 bits is six bytes from element zero', () => {
    expect(extentForDataBlock({ unit: 'bits' }, 0, 6).end).toBe(48)
  })

  it('reports where the block STARTS, not only where it ends', () => {
    // The half that used to be missing. A block at element 100 produces
    // nothing below 100, and backing from zero would vouch for a hundred
    // addresses the plugin never writes.
    expect(extentForDataBlock({ unit: 'words' }, 100, 8)).toEqual({ start: 100, end: 104 })
    expect(extentForDataBlock({ unit: 'words' }, 0, 8)).toEqual({ start: 0, end: 4 })
  })

  it('scales the start the same way it scales the end, for a BOOL table', () => {
    // Element 2 of a bool table is bit 16, not bit 2.
    expect(extentForDataBlock({ unit: 'bits' }, 2, 4)).toEqual({ start: 16, end: 48 })
  })

  it('adds the start buffer, because the image is contiguous', () => {
    expect(extentForDataBlock({ unit: 'words' }, 100, 8).end).toBe(104)
    expect(extentForDataBlock({ unit: 'words' }, 0, 0).end).toBe(0)
  })
})
