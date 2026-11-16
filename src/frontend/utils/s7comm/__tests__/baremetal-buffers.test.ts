/**
 * The bare-metal buffer list and the header's codes are one fact.
 *
 * `BAREMETAL_S7_BUFFERS` says which mappings the board can address and
 * `BUFFER_CODE` in the header says what each one is called in the firmware.
 * They are separate because one is a capability and the other is an ABI name,
 * and nothing but this test stops them drifting — a type in the list with no
 * code emits a row the firmware cannot read, and a code with no entry in the
 * list is a buffer the board has and the editor refuses to use.
 *
 * The list cannot be derived from the image tables: `openplc.h` declares
 * `dint_input` and `dint_output` arrays that the S7 plugin has no code for.
 */

import {
  BAREMETAL_S7_BUFFERS,
  DEFAULT_S7_PROFILE,
  RUNTIME_S7_BUFFERS,
} from '@root/middleware/shared/utils/target-capabilities'

import { IMAGE_TABLES } from '@root/middleware/shared/utils/io-image/tables'

import { collectS7Areas } from '../generate-s7comm-header'

const blockOf = (type: string) => ({
  server: { enabled: true, bindAddress: '0.0.0.0', port: 102, maxClients: 2, pduSize: 240 },
  dataBlocks: [{ dbNumber: 1, description: '', sizeBytes: 8, mapping: { type, startBuffer: 0 } }],
})

describe('the bare-metal buffer list', () => {
  it.each([...BAREMETAL_S7_BUFFERS])('emits a real firmware code for %s', (type) => {
    const [area] = collectS7Areas(blockOf(type), DEFAULT_S7_PROFILE, () => undefined)

    expect(area).toBeDefined()
    // The fallback the mapping falls back to when no code exists; reaching it
    // means the list claims a buffer the header cannot name.
    expect(area.buffer).not.toBe('S7COMM_BUF_NONE')
    expect(area.buffer).toMatch(/^S7COMM_BUF_[A-Z_]+$/)
  })

  it.each([...RUNTIME_S7_BUFFERS].filter((type) => !BAREMETAL_S7_BUFFERS.includes(type)))(
    'drops %s, which this target has no array for',
    (type) => {
      const warn = jest.fn()
      expect(collectS7Areas(blockOf(type), DEFAULT_S7_PROFILE, warn)).toEqual([])
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(type))
    },
  )

  it('covers every mapping the editor can store, one way or the other', () => {
    // The schema admits exactly the image table keys, so a type outside this
    // list would reach the selection and be dropped as "unknown buffer type"
    // -- the message meant for a project edited outside the editor.
    expect([...RUNTIME_S7_BUFFERS].sort()).toEqual(IMAGE_TABLES.map((table) => table.key).sort())
    // And bare metal is a subset of it, never something else.
    for (const type of BAREMETAL_S7_BUFFERS) expect(RUNTIME_S7_BUFFERS).toContain(type)
  })
})
