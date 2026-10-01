import { DEFAULT_S7_PROFILE } from '@root/middleware/shared/utils/target-capabilities/presets'
import type { S7TargetProfile } from '@root/middleware/shared/utils/target-capabilities/types'

import type { S7CommSlaveConfigLike } from '../generate-s7comm-header'
import { collectS7Areas, generateS7CommHeaderContent } from '../generate-s7comm-header'

const profile = (over: Partial<S7TargetProfile> = {}): S7TargetProfile => ({ ...DEFAULT_S7_PROFILE, ...over })

const config = (over: Partial<S7CommSlaveConfigLike> = {}): S7CommSlaveConfigLike => ({
  server: { enabled: true, bindAddress: '0.0.0.0', port: 102, maxClients: 2, pduSize: 240 },
  dataBlocks: [],
  ...over,
})

const db = (dbNumber: number, type = 'int_memory', startBuffer = 0, sizeBytes = 40) => ({
  dbNumber,
  description: '',
  sizeBytes,
  mapping: { type, startBuffer, bitAddressing: false },
})

describe('the disabled header', () => {
  it('is emitted when the project has no S7 server, not nothing', () => {
    // The runtime includes s7comm_config.h unconditionally. Emitting no file
    // would break the build on every target rather than compiling the server
    // out, which is the entire point of the stub contract.
    const out = generateS7CommHeaderContent({ config: null, profile: profile() })
    expect(out).toContain('#define S7COMM_ENABLED 0')
    expect(out).not.toContain('S7COMM_AREAS')
  })

  it('is emitted when the server exists but is switched off', () => {
    const out = generateS7CommHeaderContent({
      config: config({ server: { ...config().server, enabled: false } }),
      profile: profile(),
    })
    expect(out).toContain('#define S7COMM_ENABLED 0')
  })

  it('is emitted when the server is on but nothing could be mapped', () => {
    // A server with no areas accepts connections and answers every read with
    // "out of range". Compiling it out and saying so beats shipping that.
    const warn = jest.fn()
    const out = generateS7CommHeaderContent({
      config: config({ dataBlocks: [db(1, 'bool_memory')] }),
      profile: profile(),
      warn,
    })
    expect(out).toContain('#define S7COMM_ENABLED 0')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no area could be mapped'))
  })
})

describe('the area table', () => {
  it('is const, so it lives in flash rather than costing RAM', () => {
    const out = generateS7CommHeaderContent({ config: config({ dataBlocks: [db(1)] }), profile: profile() })
    expect(out).toContain('static const s7comm_area_t S7COMM_AREAS[S7COMM_AREA_COUNT]')
  })

  it('counts what it emitted, so the runtime never walks past the end', () => {
    const out = generateS7CommHeaderContent({
      config: config({ dataBlocks: [db(1), db(2), db(3)] }),
      profile: profile(),
    })
    expect(out).toContain('#define S7COMM_AREA_COUNT 3')
    expect(out.match(/\{ S7COMM_AREA_/g)).toHaveLength(3)
  })

  it('orders the system areas PE, PA, MK ahead of the data blocks', () => {
    // The order a Wireshark capture shows them in, which is the order someone
    // debugging this will be reading.
    const out = generateS7CommHeaderContent({
      config: config({
        dataBlocks: [db(1)],
        systemAreas: {
          mkArea: { enabled: true, sizeBytes: 8, mapping: { type: 'int_memory', startBuffer: 0 } },
          peArea: { enabled: true, sizeBytes: 7, mapping: { type: 'bool_input', startBuffer: 0 } },
          paArea: { enabled: true, sizeBytes: 7, mapping: { type: 'bool_output', startBuffer: 0 } },
        },
      }),
      profile: profile(),
    })
    const order = [...out.matchAll(/\{ (S7COMM_AREA_\w+)/g)].map((m) => m[1])
    expect(order).toEqual(['S7COMM_AREA_PE', 'S7COMM_AREA_PA', 'S7COMM_AREA_MK', 'S7COMM_AREA_DB'])
  })

  it('marks the process-INPUT area read-only', () => {
    // PE is what the field wires drive. A client that writes it is writing a
    // value the next input refresh overwrites, which looks to the client like
    // the write was silently lost. Refusing is the honest answer.
    const areas = collectS7Areas(
      config({
        systemAreas: {
          peArea: { enabled: true, sizeBytes: 7, mapping: { type: 'bool_input', startBuffer: 0 } },
          paArea: { enabled: true, sizeBytes: 7, mapping: { type: 'bool_output', startBuffer: 0 } },
        },
      }),
      profile(),
      () => undefined,
    )
    expect(areas.find((a) => a.area === 'S7COMM_AREA_PE')?.writable).toBe(false)
    expect(areas.find((a) => a.area === 'S7COMM_AREA_PA')?.writable).toBe(true)
  })

  it('skips a disabled system area', () => {
    const areas = collectS7Areas(
      config({
        systemAreas: { mkArea: { enabled: false, sizeBytes: 8, mapping: { type: 'int_memory', startBuffer: 0 } } },
      }),
      profile(),
      () => undefined,
    )
    expect(areas).toHaveLength(0)
  })
})

describe('what the build refuses, and says so', () => {
  it('refuses a buffer that exists only on Runtime v3/v4, naming it', () => {
    // The alternative is a device that accepts a connection and then answers
    // some addresses and not others, with no way for the user to tell which.
    const warn = jest.fn()
    collectS7Areas(config({ dataBlocks: [db(1, 'bool_memory')] }), profile(), warn)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('bool_memory'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Runtime v3/v4'))
  })

  it('refuses an unknown buffer type without pretending to know it', () => {
    const warn = jest.fn()
    const areas = collectS7Areas(config({ dataBlocks: [db(1, 'not_a_buffer')] }), profile(), warn)
    expect(areas).toHaveLength(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown buffer type'))
  })

  it('refuses a duplicate DB number rather than emitting two rows for it', () => {
    // find_area() returns the first match, so a second row for the same DB is
    // unreachable — and silently unreachable is the worst kind.
    const warn = jest.fn()
    const areas = collectS7Areas(config({ dataBlocks: [db(1), db(1)] }), profile(), warn)
    expect(areas).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('repeats a DB number'))
  })

  it('stops at the target ceiling and names where it stopped', () => {
    const warn = jest.fn()
    const areas = collectS7Areas(
      config({ dataBlocks: [db(1), db(2), db(3), db(4)] }),
      profile({ maxDataBlocks: 2 }),
      warn,
    )
    expect(areas).toHaveLength(2)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('allows 2 data blocks'))
  })

  it('skips a system area with no mapping at all', () => {
    const warn = jest.fn()
    collectS7Areas(config({ systemAreas: { mkArea: { enabled: true, sizeBytes: 8 } } }), profile(), warn)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no buffer mapping'))
  })
})

describe('clamping to what the target can actually do', () => {
  it('clamps the PDU down and explains that clients adapt', () => {
    const warn = jest.fn()
    const out = generateS7CommHeaderContent({
      config: config({ server: { ...config().server, pduSize: 960 }, dataBlocks: [db(1)] }),
      profile: profile({ pduSize: 240 }),
      warn,
    })
    expect(out).toContain('#define S7COMM_PDU_SIZE 240')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('240 will be negotiated'))
  })

  it('never clamps the PDU below the protocol floor', () => {
    const out = generateS7CommHeaderContent({
      config: config({ server: { ...config().server, pduSize: 16 }, dataBlocks: [db(1)] }),
      profile: profile({ pduSize: 480 }),
    })
    expect(out).toContain('#define S7COMM_PDU_SIZE 240')
  })

  it('grants a PDU the target can afford', () => {
    const out = generateS7CommHeaderContent({
      config: config({ server: { ...config().server, pduSize: 480 }, dataBlocks: [db(1)] }),
      profile: profile({ pduSize: 960 }),
    })
    expect(out).toContain('#define S7COMM_PDU_SIZE 480')
  })

  it('clamps maxClients and says what each one costs', () => {
    // The expensive dimension: every client is a receive/transmit PDU pair.
    const warn = jest.fn()
    const out = generateS7CommHeaderContent({
      config: config({ server: { ...config().server, maxClients: 32 }, dataBlocks: [db(1)] }),
      profile: profile({ maxClients: 2, pduSize: 240 }),
      warn,
    })
    expect(out).toContain('#define S7COMM_MAX_CLIENTS 2')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('240-byte receive/transmit pair'))
  })

  it('takes writeEnabled and szl from the TARGET, not the project', () => {
    // Whether the silicon can afford the identification service, and whether
    // this device should accept writes at all, are facts about the target.
    const out = generateS7CommHeaderContent({
      config: config({ dataBlocks: [db(1)] }),
      profile: profile({ writeEnabled: false, szl: true }),
    })
    expect(out).toContain('#define S7COMM_WRITE_ENABLED 0')
    expect(out).toContain('#define S7COMM_SZL_ENABLED 1')
  })
})

describe('identity', () => {
  it('is emitted with escaped C strings', () => {
    const out = generateS7CommHeaderContent({
      config: config({
        dataBlocks: [db(1)],
        plcIdentity: {
          name: 'He said "hi"',
          moduleType: 'CPU 315-2 PN/DP',
          serialNumber: 'S C-X',
          copyright: 'Original Siemens Equipment',
          moduleName: 'OpenPLC',
        },
      }),
      profile: profile(),
    })
    expect(out).toContain('#define S7COMM_ID_NAME "He said \\"hi\\""')
    expect(out).toContain('#define S7COMM_ID_MODULE_TYPE "CPU 315-2 PN/DP"')
  })

  it('is simply absent when the project declares none', () => {
    const out = generateS7CommHeaderContent({ config: config({ dataBlocks: [db(1)] }), profile: profile() })
    expect(out).not.toContain('S7COMM_ID_NAME')
  })
})
