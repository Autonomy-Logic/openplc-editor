/**
 * Tests for the `image.conf` a runtime-v4 upload carries (DOPE-615).
 *
 * The case that most needs pinning is the unit, and in format 2 it is pinned
 * twice: the value carries its unit as a word, and the three BOOL tables stay
 * in BITS because `%QX` addresses bits. Converting to the `[N][8]` shape the
 * storage actually has is the runtime's job, done where that shape is known.
 *
 * This inverts what version 1 asserted. That version divided here and wrote a
 * bare number, so a reader had to already know which tables were in bytes —
 * exactly the knowledge a factor-of-eight bug depends on being wrong. Nothing
 * on a device ever read it: none of the three pull requests had merged.
 */

import { generateImageConf } from '../steps/generate-image-conf'

interface Entry {
  count: number
  unit: string
}

/** Parse the emitted body back into a map, ignoring comments. */
function parse(body: string): Record<string, Entry> {
  const out: Record<string, Entry> = {}
  for (const line of body.trimEnd().split('\n')) {
    if (line.startsWith('#')) continue
    const [key, rest] = line.split('=')
    const [count, unit] = rest.split(' ')
    out[key] = { count: Number(count), unit: unit ?? '' }
  }
  return out
}

/** Just the counts, for the assertions that do not care about the unit. */
function counts(body: string): Record<string, number> {
  return Object.fromEntries(Object.entries(parse(body)).map(([key, entry]) => [key, entry.count]))
}

/** The fourteen tables of `core/src/plc_app/image_tables.h`, and the unit each
 *  one's addresses use. The runtime's contract test checks the same pairing
 *  from the C side, so a disagreement fails on both. */
const TABLE_UNITS: ReadonlyArray<readonly [string, string]> = [
  ['bool_input', 'bits'],
  ['bool_output', 'bits'],
  ['byte_input', 'bytes'],
  ['byte_output', 'bytes'],
  ['int_input', 'words'],
  ['int_output', 'words'],
  ['dint_input', 'dwords'],
  ['dint_output', 'dwords'],
  ['lint_input', 'lwords'],
  ['lint_output', 'lwords'],
  ['int_memory', 'words'],
  ['dint_memory', 'dwords'],
  ['lint_memory', 'lwords'],
  ['bool_memory', 'bits'],
]
const ALL_KEYS = TABLE_UNITS.map(([key]) => key)

describe('generateImageConf', () => {
  it('declares the format version, before any table', () => {
    // A parser that reads a version it does not know must refuse rather than
    // guess, and it can only do that if the version arrives first.
    const lines = generateImageConf({})
      .split('\n')
      .filter((line) => line && !line.startsWith('#'))
    expect(lines[0]).toBe('format_version=2')
  })

  it('writes every table, including the ones sized to zero', () => {
    // "Absent means zero" is an editor-side convention; the C parser should
    // not have to know it.
    expect(Object.keys(counts(generateImageConf({})))).toEqual(['format_version', ...ALL_KEYS])
    expect(ALL_KEYS.every((key) => counts(generateImageConf({}))[key] === 0)).toBe(true)
  })

  it('has no key the runtime does not declare a table for', () => {
    // Notably no `byte_memory`: %MB has no storage on v4.
    expect(Object.keys(counts(generateImageConf({})))).not.toContain('byte_memory')
  })

  it.each(TABLE_UNITS)('states the unit of %s as %s', (key, unit) => {
    expect(parse(generateImageConf({}))[key].unit).toBe(unit)
  })

  it('counts the BOOL tables in bits, and does not divide them', () => {
    // The pair that catches a factor-of-eight regression, first direction.
    // 64 bits of %QX stays 64 here; the runtime allocates bool_output[8][8].
    const conf = counts(generateImageConf({ '%IX': 16, '%QX': 64, '%MX': 8 }))
    expect(conf.bool_input).toBe(16)
    expect(conf.bool_output).toBe(64)
    expect(conf.bool_memory).toBe(8)
  })

  it('does not pad a bit count to a whole byte either', () => {
    // Second direction. Six coils are six, not eight: the padding belongs to
    // bare metal, which declares bool_output[MAX/8][8] and divides. Padding
    // here would have made the Modbus server advertise two coils the program
    // has no variable for.
    expect(counts(generateImageConf({ '%QX': 6 })).bool_output).toBe(6)
    expect(counts(generateImageConf({ '%QX': 9 })).bool_output).toBe(9)
  })

  it('counts every other table in its own width', () => {
    // `int_memory[20]` holds twenty %MWs — no division anywhere.
    const conf = counts(
      generateImageConf({
        '%IB': 3,
        '%QB': 4,
        '%IW': 32,
        '%QW': 32,
        '%ID': 5,
        '%QD': 6,
        '%IL': 7,
        '%QL': 8,
        '%MW': 20,
        '%MD': 9,
        '%ML': 10,
      }),
    )
    expect(conf).toMatchObject({
      byte_input: 3,
      byte_output: 4,
      int_input: 32,
      int_output: 32,
      dint_input: 5,
      dint_output: 6,
      lint_input: 7,
      lint_output: 8,
      int_memory: 20,
      dint_memory: 9,
      lint_memory: 10,
    })
  })

  it('can produce an image smaller than the fixed one it replaces', () => {
    // BR10, and the point of the whole change: the memory a program does not
    // use goes back to the program. BUFFER_SIZE was 1024 for all fourteen.
    const conf = counts(generateImageConf({ '%QX': 8, '%MW': 4 }))
    expect(conf.bool_output).toBe(8)
    expect(conf.int_memory).toBe(4)
    expect(conf.int_input).toBe(0)
  })

  it('is deterministic and stable in key order', () => {
    // FR07, and what the compile cache and the cross-repo diff depend on.
    const sizes = { '%QX': 16, '%MW': 7 }
    expect(generateImageConf(sizes)).toBe(generateImageConf(sizes))
    // Insertion order of the input must not leak into the output.
    expect(generateImageConf({ '%MW': 7, '%QX': 16 })).toBe(generateImageConf(sizes))
  })

  it('explains the unit in the file itself', () => {
    // A reader on the device has no access to this reasoning otherwise, and
    // the bits-vs-bytes distinction is the one that silently breaks things.
    const body = generateImageConf({})
    expect(body).toContain('image_tables.h')
    expect(body).toContain('bits')
    expect(body.startsWith('#')).toBe(true)
    expect(body.endsWith('\n')).toBe(true)
  })
})
