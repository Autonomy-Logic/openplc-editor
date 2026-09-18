/**
 * The S7comm data block's start buffer is bounded by the ABI, not by a
 * runtime constant (DOPE-615, A6).
 *
 * It used to stop at 1023, which was the runtime's fixed `BUFFER_SIZE`
 * transcribed into a protocol schema as if it were a fact about S7comm. Once
 * the image is sized from the project, that number describes nothing: a
 * project may need far more, and a project needing eight is not entitled to
 * 1023 either.
 *
 * What remains is CON03 — a located variable's index is a uint16 in the
 * STruC++ ABI, so 65535 is the highest element any area can address. The
 * bound stays, because an unbounded start buffer would be a number with no
 * meaning rather than a freedom.
 */

import { S7CommBufferMappingSchema } from '../PLC/open-plc'

const block = (startBuffer: number) => ({
  type: 'int_output',
  startBuffer,
  bitAddressing: false,
})

describe('S7CommBufferMappingSchema.startBuffer', () => {
  it('accepts a start buffer above the old fixed image', () => {
    // The case the change exists for: 1023 was BUFFER_SIZE, not a limit.
    expect(S7CommBufferMappingSchema.safeParse(block(1024)).success).toBe(true)
    expect(S7CommBufferMappingSchema.safeParse(block(4000)).success).toBe(true)
  })

  it('accepts the highest element the ABI can address', () => {
    expect(S7CommBufferMappingSchema.safeParse(block(65535)).success).toBe(true)
  })

  it('refuses one past the ABI limit', () => {
    // The bound is not removed, only corrected. A uint16 index cannot reach
    // here, so a block declared at 65536 could never be read.
    expect(S7CommBufferMappingSchema.safeParse(block(65536)).success).toBe(false)
    expect(S7CommBufferMappingSchema.safeParse(block(70000)).success).toBe(false)
  })

  it('still refuses a negative start buffer', () => {
    expect(S7CommBufferMappingSchema.safeParse(block(-1)).success).toBe(false)
  })

  it('accepts zero', () => {
    expect(S7CommBufferMappingSchema.safeParse(block(0)).success).toBe(true)
  })
})
