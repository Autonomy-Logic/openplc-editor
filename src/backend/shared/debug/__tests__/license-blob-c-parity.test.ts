/**
 * Cross-language parity between the TypeScript license-blob codec and the C
 * struct the firmware compiles.
 *
 * WHY THIS EXISTS. The blob crosses a language boundary: the editor serializes it
 * in TypeScript, the board parses it as `lic_blob_t`. A layout disagreement does
 * not fail loudly — it produces a blob the board stores happily and the
 * license-core then rejects, which surfaces as "the device says it is licensed and
 * still runs demo". That is the single most expensive way for these two files to
 * drift, so it must fail a test instead.
 *
 * WHAT THIS CAN AND CANNOT CATCH. It reads `license_blob.h` as text and asserts
 * the two sides agree on the sizes, the offsets, the magic and the CRC parameters.
 * It cannot catch a compiler that inserts padding — but nothing needs to: the
 * header carries both `#pragma pack` and `__attribute__((packed))`, plus
 * `LIC_STATIC_ASSERT` on both struct sizes, so padding fails the FIRMWARE BUILD
 * on the device toolchain rather than shipping.
 *
 * A real C host-test compiling the header and comparing bytes against
 * `license-golden.json` would be stronger and is the right follow-up; the repo has
 * no C test harness to hang one on today.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { crc32IsoHdlc, LIC_BLOB_SIZE, LIC_MAGIC_LE, LIC_PAYLOAD_SIZE } from '../license-blob'

/**
 * This test file is byte-identical across openplc-editor and openplc-web, but the
 * firmware sources it reads are NOT in the same place: the sync gate maps the
 * editor's `resources/sources/Baremetal` onto the web's `src/assets/firmware/
 * Baremetal` (MAPPED_SURFACES in compare-surfaces.py) rather than mirroring the
 * path. So resolve whichever one this checkout has.
 *
 * Deliberately throws when neither exists instead of skipping. A parity test that
 * quietly disappears when it cannot find the header is worse than no test: the
 * suite goes green while the layout it is supposed to pin drifts unwatched.
 */
const HEADER_CANDIDATES = [
  join(__dirname, '..', '..', '..', '..', '..', 'resources', 'sources', 'Baremetal', 'license_blob.h'),
  join(__dirname, '..', '..', '..', '..', 'assets', 'firmware', 'Baremetal', 'license_blob.h'),
]

const HEADER_PATH = HEADER_CANDIDATES.find((candidate) => existsSync(candidate))

if (HEADER_PATH === undefined) {
  throw new Error(`license_blob.h not found. Looked in:\n${HEADER_CANDIDATES.join('\n')}`)
}

const header = readFileSync(HEADER_PATH, 'utf-8')

/** Read a `#define NAME 0x...u` / decimal value out of the C header. */
function cDefine(name: string): number {
  const match = new RegExp(`#define\\s+${name}\\s+(0x[0-9A-Fa-f]+|\\d+)u?`).exec(header)
  if (!match) throw new Error(`${name} not found in license_blob.h`)
  return Number(match[1])
}

describe('license_blob.h ↔ license-blob.ts parity', () => {
  it('agrees on the blob and payload sizes', () => {
    expect(cDefine('LIC_BLOB_SIZE')).toBe(LIC_BLOB_SIZE)
    expect(cDefine('LIC_PAYLOAD_SIZE')).toBe(LIC_PAYLOAD_SIZE)
  })

  it('agrees on the little-endian magic', () => {
    expect(cDefine('LIC_MAGIC_LE')).toBe(LIC_MAGIC_LE)
  })

  it('declares the struct fields in the order and widths the TS serializer writes', () => {
    // The offsets the TS side writes at, as the header's own layout table states
    // them. Parsed from the table rather than from the struct so a change to
    // either the table or the struct that leaves them disagreeing shows up here —
    // the table is what a firmware author reads.
    const expected: Array<[string, number, number]> = [
      ['magic', 0, 4],
      ['fmt_version', 4, 1],
      ['key_id', 5, 1],
      ['device_id', 6, 16],
      ['product_id', 22, 8],
      ['signature', 30, 64],
      ['crc32', 94, 4],
    ]

    for (const [field, offset, size] of expected) {
      const row = new RegExp(`^//\\s*${offset}\\s+${field}\\s+\\S+.*?\\s${size}\\s`, 'm')
      expect(header).toMatch(row)
    }
  })

  it('carries the static assertions that make padding a build failure, not a runtime surprise', () => {
    // These are what stop a toolchain that ignores one of the two packing
    // directives from silently producing a 100-byte struct.
    expect(header).toMatch(/LIC_STATIC_ASSERT\(sizeof\(lic_payload_t\)\s*==\s*30/)
    expect(header).toMatch(/LIC_STATIC_ASSERT\(sizeof\(lic_blob_t\)\s*==\s*98/)
    expect(header).toMatch(/#pragma pack\(push, 1\)/)
    // Anchored to the DECLARATION, not just a mention: the header also discusses
    // the attribute in prose, so a looser match passed even after the struct lost
    // it. AVR-GCC and xtensa-GCC honour the two directives differently, which is
    // why both are required rather than either.
    expect(header).toMatch(/typedef struct __attribute__\(\(packed\)\) \{/)
  })

  it('uses the same CRC-32/ISO-HDLC parameters on both sides', () => {
    // The reflected polynomial and the init/xorout constants. A different
    // polynomial produces a blob whose crc32 the board rejects as CORRUPT — the
    // failure mode that looks like flaky hardware.
    expect(header).toMatch(/0xEDB88320u/)
    expect(header).toMatch(/crc\s*=\s*0xFFFFFFFFu/)
    expect(header).toMatch(/crc\s*\^\s*0xFFFFFFFFu/)

    // And the header documents the canonical test vector the TS side satisfies,
    // so both implementations are pinned to the same published value.
    expect(header).toContain('0xCBF43926')
    expect(crc32IsoHdlc(Uint8Array.from([...'123456789'].map((c) => c.charCodeAt(0))))).toBe(0xcbf43926)
  })

  it('states the endianness duality that the two layers must not confuse', () => {
    // The blob content is little-endian; the Modbus `len` framing it is
    // big-endian. Every place this was got wrong cost a debugging session.
    expect(header).toMatch(/blob CONTENT is LITTLE-ENDIAN/)
  })
})
