/**
 * Tests for the `image.conf` a runtime-v4 upload carries (DOPE-615).
 *
 * The case that most needs pinning is the unit: the three BOOL tables are
 * declared `IEC_BOOL *table[N][8]`, so their value counts BYTES while `%QX`
 * addresses BITS. Getting that backwards yields an image eight times too small
 * with no diagnostic on either side, so it is asserted from both directions
 * here.
 */

import { generateImageConf } from '../steps/generate-image-conf'

/** Parse the emitted body back into a map, ignoring comments. */
function parse(body: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const line of body.trimEnd().split('\n')) {
    if (line.startsWith('#')) continue
    const [key, value] = line.split('=')
    out[key] = Number(value)
  }
  return out
}

/** The fourteen tables of `core/src/plc_app/image_tables.h`. */
const ALL_KEYS = [
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
]

describe('generateImageConf', () => {
  it('writes every table, including the ones sized to zero', () => {
    // "Absent means zero" is an editor-side convention; the C parser should
    // not have to know it.
    const keys = Object.keys(parse(generateImageConf({})))
    expect(keys).toEqual(ALL_KEYS)
    expect(Object.values(parse(generateImageConf({})))).toEqual(new Array(ALL_KEYS.length).fill(0))
  })

  it('has no key the runtime does not declare a table for', () => {
    // Notably no `byte_memory`: %MB has no storage on v4.
    expect(Object.keys(parse(generateImageConf({})))).not.toContain('byte_memory')
  })

  it('counts the BOOL tables in bytes, not bits', () => {
    // 64 bits of %QX is `bool_output[8][8]`.
    const conf = parse(generateImageConf({ '%IX': 16, '%QX': 64, '%MX': 8 }))
    expect(conf.bool_input).toBe(2)
    expect(conf.bool_output).toBe(8)
    expect(conf.bool_memory).toBe(1)
  })

  it('counts every other table in its own width', () => {
    // `int_memory[20]` holds twenty %MWs — no division anywhere.
    const conf = parse(
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

  it('rounds a bit count up rather than down', () => {
    // Unreachable through the sizer, which rounds to whole bytes first, but
    // rounding DOWN would make the partial byte's slots unaddressable — the
    // very failure the rounding exists to prevent.
    expect(parse(generateImageConf({ '%QX': 9 })).bool_output).toBe(2)
  })

  it('can produce an image smaller than the fixed one it replaces', () => {
    // BR10, and the point of the whole change: the memory a program does not
    // use goes back to the program. BUFFER_SIZE was 1024 for all fourteen.
    const conf = parse(generateImageConf({ '%QX': 8, '%MW': 4 }))
    expect(conf.bool_output).toBe(1)
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
    expect(body).toContain('bytes')
    expect(body.startsWith('#')).toBe(true)
    expect(body.endsWith('\n')).toBe(true)
  })
})
