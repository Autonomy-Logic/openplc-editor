/**
 * The normalizer's job is that a two-line spec becomes a server the project
 * loader will accept. Every `ok: true` case therefore asserts against
 * `PLCServerSchema`-shaped output, and the error cases are the ones where a
 * config would otherwise save, upload and quietly do nothing.
 */

import { PLCServerSchema } from '../../types/PLC/open-plc'
import { normalizeServerSpec } from '../normalize-server-spec'
import type { SpecServer } from '../types'

const ok = (spec: SpecServer) => {
  const result = normalizeServerSpec(spec)
  if (!result.ok) throw new Error(`expected ok, got: ${result.errors.join(' | ')}`)
  // What the loader will do on the next open.
  expect(PLCServerSchema.safeParse(result.value).success).toBe(true)
  return result.value
}

const errorsOf = (spec: SpecServer) => {
  const result = normalizeServerSpec(spec)
  return result.ok ? [] : result.errors
}

describe('a Modbus TCP server', () => {
  it('builds from nothing but a name and a protocol', () => {
    const server = ok({ name: 'Plant', protocol: 'modbus-tcp' })
    expect(server.modbusSlaveConfig).toEqual({ enabled: false, networkInterface: '0.0.0.0', port: 502 })
  })

  it('puts the single top-level enabled where Modbus reads it', () => {
    expect(ok({ name: 'Plant', protocol: 'modbus-tcp', enabled: true }).modbusSlaveConfig?.enabled).toBe(true)
  })

  it('keeps the sibling defaults when the spec overrides one field', () => {
    const server = ok({ name: 'Plant', protocol: 'modbus-tcp', modbus: { port: 1502 } })
    expect(server.modbusSlaveConfig?.port).toBe(1502)
    expect(server.modbusSlaveConfig?.networkInterface).toBe('0.0.0.0')
  })

  it('carries a partial bufferMapping through without filling it in', () => {
    // The generator defaults each missing count; storing invented values here
    // would make a project look like the author chose them.
    const server = ok({ name: 'Plant', protocol: 'modbus-tcp', modbus: { bufferMapping: { coils: { qxBits: 16 } } } })
    expect(server.modbusSlaveConfig?.bufferMapping).toEqual({ coils: { qxBits: 16 } })
  })
})

describe('an S7comm server', () => {
  it('builds the full default server, identity and logging', () => {
    const server = ok({ name: 'S7', protocol: 's7comm' })
    expect(server.s7commSlaveConfig?.server.port).toBe(102)
    expect(server.s7commSlaveConfig?.server.pduSize).toBe(480)
    expect(server.s7commSlaveConfig?.plcIdentity?.name).toBe('OpenPLC Runtime')
    expect(server.s7commSlaveConfig?.dataBlocks).toEqual([])
  })

  it('puts the top-level enabled on server.enabled, which the plugin reads', () => {
    expect(ok({ name: 'S7', protocol: 's7comm', enabled: true }).s7commSlaveConfig?.server.enabled).toBe(true)
  })

  it('takes data blocks whole', () => {
    const server = ok({
      name: 'S7',
      protocol: 's7comm',
      s7comm: {
        dataBlocks: [
          {
            dbNumber: 1,
            description: 'Process',
            sizeBytes: 256,
            mapping: { type: 'int_output', startBuffer: 0, bitAddressing: false },
          },
        ],
      },
    })
    expect(server.s7commSlaveConfig?.dataBlocks).toHaveLength(1)
    expect(server.s7commSlaveConfig?.dataBlocks[0].dbNumber).toBe(1)
  })

  it('refuses two data blocks on the same DB number', () => {
    // The editor refuses `DB1 already exists`; letting two through means only
    // one of them answers on the wire.
    const block = (dbNumber: number) => ({
      dbNumber,
      description: 'x',
      sizeBytes: 64,
      mapping: { type: 'int_output' as const, startBuffer: 0, bitAddressing: false },
    })
    expect(
      errorsOf({ name: 'S7', protocol: 's7comm', s7comm: { dataBlocks: [block(1), block(1)] } }).join(' '),
    ).toContain('DB1 is declared more than once')
  })

  it('accepts two data blocks on different numbers', () => {
    const block = (dbNumber: number) => ({
      dbNumber,
      description: 'x',
      sizeBytes: 64,
      mapping: { type: 'int_output' as const, startBuffer: 0, bitAddressing: false },
    })
    const server = ok({ name: 'S7', protocol: 's7comm', s7comm: { dataBlocks: [block(1), block(2)] } })
    expect(server.s7commSlaveConfig?.dataBlocks).toHaveLength(2)
  })

  it('rejects a value the authoritative schema bounds', () => {
    // pduSize is 240..960 — a spec-only check would have let this through.
    expect(errorsOf({ name: 'S7', protocol: 's7comm', s7comm: { server: { pduSize: 12 } } }).join(' ')).toContain(
      'pduSize',
    )
  })
})

describe('an OPC-UA server', () => {
  it('builds the default profile, security and address space', () => {
    const server = ok({ name: 'Ua', protocol: 'opcua' })
    expect(server.opcuaServerConfig?.server.port).toBe(4840)
    expect(server.opcuaServerConfig?.securityProfiles).toHaveLength(1)
    expect(server.opcuaServerConfig?.security.serverPrivateKeyCustom).toBeNull()
    expect(server.opcuaServerConfig?.addressSpace.nodes).toEqual([])
  })

  it('derives ids the GUI would have generated, so a round trip is stable', () => {
    const server = ok({
      name: 'Ua',
      protocol: 'opcua',
      opcua: {
        securityProfiles: [
          {
            name: 'secure',
            enabled: true,
            securityPolicy: 'Basic256Sha256',
            securityMode: 'SignAndEncrypt',
            authMethods: ['Username'],
          },
        ],
        users: [{ type: 'password', username: 'op', passwordHash: 'hash', certificateId: null, role: 'operator' }],
        addressSpace: {
          nodes: [
            {
              pouName: 'Main',
              variablePath: 'Level',
              variableType: 'INT',
              nodeId: 'ns=1;s=Main.Level',
              browseName: 'Level',
              displayName: 'Level',
              description: '',
              permissions: { viewer: 'r', operator: 'rw', engineer: 'rw' },
              nodeType: 'variable',
            },
          ],
        },
      },
    })

    expect(server.opcuaServerConfig?.securityProfiles[0].id).toBe('profile-secure')
    expect(server.opcuaServerConfig?.users[0].id).toBe('user-op')
    expect(server.opcuaServerConfig?.addressSpace.nodes[0].id).toBe('Main.Level')
  })

  it('leaves an id the spec supplies alone', () => {
    const server = ok({
      name: 'Ua',
      protocol: 'opcua',
      opcua: {
        securityProfiles: [
          {
            id: 'kept',
            name: 'secure',
            enabled: true,
            securityPolicy: 'None',
            securityMode: 'None',
            authMethods: ['Anonymous'],
          },
        ],
      },
    })
    expect(server.opcuaServerConfig?.securityProfiles[0].id).toBe('kept')
  })

  it('replaces the default profile list rather than merging into it', () => {
    // Arrays replace: otherwise removing the built-in insecure profile would be
    // impossible to express.
    const server = ok({
      name: 'Ua',
      protocol: 'opcua',
      opcua: {
        securityProfiles: [
          {
            name: 'only',
            enabled: true,
            securityPolicy: 'Basic256Sha256',
            securityMode: 'Sign',
            authMethods: ['Certificate'],
          },
        ],
      },
    })
    expect(server.opcuaServerConfig?.securityProfiles).toHaveLength(1)
    expect(server.opcuaServerConfig?.securityProfiles[0].name).toBe('only')
  })
})

describe('what it refuses', () => {
  it('refuses a protocol with no configuration surface', () => {
    expect(errorsOf({ name: 'X', protocol: 'ethernet-ip' as never }).join(' ')).toContain('ethernet-ip')
  })

  it('refuses a name that is not a legal identifier', () => {
    expect(errorsOf({ name: 'my server', protocol: 'modbus-tcp' }).join(' ')).toContain(
      'not a legal name — it contains illegal characters',
    )
  })

  it('refuses an empty name without crashing', () => {
    expect(errorsOf({ name: '', protocol: 'modbus-tcp' })).toEqual(['A server needs a name.'])
  })

  it('refuses a config block belonging to another protocol', () => {
    // Silently ignoring it is how an author spends an afternoon on a setting
    // that was never read.
    expect(errorsOf({ name: 'Plant', protocol: 'modbus-tcp', opcua: { cycleTimeMs: 50 } }).join(' ')).toContain(
      'that block is ignored',
    )
  })
})
