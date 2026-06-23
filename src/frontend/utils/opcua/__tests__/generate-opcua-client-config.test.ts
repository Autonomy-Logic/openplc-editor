import type {
  OpcUaClientConfig,
  OpcUaClientMapping,
  OpcUaClientSecurity,
  PLCRemoteDevice,
} from '@root/middleware/shared/ports/open-plc-types'

import {
  generateOpcUaClientConfig,
  OPCUA_CLIENT_CONFIG_FORMAT_VERSION,
  validateOpcUaClientConfig,
} from '../generate-opcua-client-config'
import { OpcUaConfigError } from '../resolve-indices'
import type { PLCInstanceInfo } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal debug-map.json string. GVL leaves resolve by uppercased path. */
const debugMapJson = (
  leaves: Array<{ path: string; type: string; arr: number; elem: number; size?: number }>,
): string =>
  JSON.stringify({
    version: 2,
    md5: 'deadbeef',
    typeTags: { BOOL: 0, INT: 3, REAL: 9, DINT: 5 },
    arrays: [{ index: 0, count: leaves.length }],
    leaves: leaves.map((l) => ({
      arrayIdx: l.arr,
      elemIdx: l.elem,
      path: l.path,
      type: l.type,
      size: l.size ?? 2,
    })),
  })

const baseSecurity = (): OpcUaClientSecurity => ({
  securityPolicy: 'None',
  securityMode: 'None',
  authMode: 'anonymous',
  username: null,
  password: null,
  clientCertPem: null,
  clientKeyPem: null,
  serverCertPem: null,
})

const makeMapping = (overrides: Partial<OpcUaClientMapping> = {}): OpcUaClientMapping => ({
  id: 'm1',
  pouName: 'GVL',
  variablePath: 'COUNTER',
  variableType: 'INT',
  remoteNodeId: 'ns=2;s=Counter',
  direction: 'remote_to_plc',
  cycleTimeMs: 100,
  ...overrides,
})

const baseClientConfig = (overrides: Partial<OpcUaClientConfig> = {}): OpcUaClientConfig => ({
  enabled: true,
  endpointUrl: 'opc.tcp://192.168.0.50:4840/x',
  sessionTimeoutMs: 60000,
  reconnect: true,
  security: baseSecurity(),
  mappings: [],
  ...overrides,
})

const makeDevice = (config: OpcUaClientConfig, name = 'RemotePLC_A'): PLCRemoteDevice => ({
  name,
  protocol: 'opc-ua-client',
  opcuaClientConfig: config,
})

const instances: PLCInstanceInfo[] = [{ name: 'INSTANCE0', task: 'TASK0', program: 'MAIN' }]

// ---------------------------------------------------------------------------
// generateOpcUaClientConfig
// ---------------------------------------------------------------------------

describe('generateOpcUaClientConfig', () => {
  it('returns null when remoteDevices is undefined', () => {
    expect(generateOpcUaClientConfig(undefined, debugMapJson([]), [])).toBeNull()
  })

  it('returns null when remoteDevices is empty', () => {
    expect(generateOpcUaClientConfig([], debugMapJson([]), [])).toBeNull()
  })

  it('returns null when no opc-ua-client device is enabled', () => {
    const device = makeDevice(baseClientConfig({ enabled: false, mappings: [makeMapping()] }))
    expect(generateOpcUaClientConfig([device], debugMapJson([]), [])).toBeNull()
  })

  it('throws when debug map is empty but mappings exist', () => {
    const device = makeDevice(baseClientConfig({ mappings: [makeMapping()] }))
    expect(() => generateOpcUaClientConfig([device], debugMapJson([]), instances)).toThrow(OpcUaConfigError)
  })

  it('stamps the contract format_version and protocol envelope', () => {
    const device = makeDevice(baseClientConfig())
    const json = generateOpcUaClientConfig([device], debugMapJson([]), [])!
    const parsed = JSON.parse(json) as Array<{ name: string; protocol: string; config: { format_version: number } }>
    expect(parsed[0].name).toBe('opcua_client')
    expect(parsed[0].protocol).toBe('OPC-UA-Client')
    expect(parsed[0].config.format_version).toBe(OPCUA_CLIENT_CONFIG_FORMAT_VERSION)
  })

  it('resolves a mapping local variable to canonical (arr, elem, datatype, size) from the debug map', () => {
    // Stored variableType is INT, but the compiler says the leaf is a
    // 4-byte DINT — the emitted datatype/size come from the debug map.
    const device = makeDevice(
      baseClientConfig({
        mappings: [
          makeMapping({
            pouName: 'GVL',
            variablePath: 'COUNTER',
            variableType: 'INT',
            remoteNodeId: 'ns=2;s=Counter',
            direction: 'remote_to_plc',
            cycleTimeMs: 250,
          }),
        ],
      }),
    )
    const json = generateOpcUaClientConfig(
      [device],
      debugMapJson([{ path: 'COUNTER', type: 'DINT', arr: 0, elem: 3, size: 4 }]),
      [],
    )!
    const parsed = JSON.parse(json) as Array<{
      config: {
        servers: Array<{
          endpoint_url: string
          session_timeout_ms: number
          reconnect: boolean
          mappings: Array<{
            remote_node_id: string
            arr: number
            elem: number
            datatype: string
            size: number
            direction: string
            cycle_time_ms: number
          }>
        }>
      }
    }>
    const server = parsed[0].config.servers[0]
    expect(server.endpoint_url).toBe('opc.tcp://192.168.0.50:4840/x')
    expect(server.session_timeout_ms).toBe(60000)
    expect(server.reconnect).toBe(true)
    expect(server.mappings[0]).toMatchObject({
      remote_node_id: 'ns=2;s=Counter',
      arr: 0,
      elem: 3,
      datatype: 'DINT',
      size: 4,
      direction: 'remote_to_plc',
      cycle_time_ms: 250,
    })
  })

  it('passes security through to snake_case', () => {
    const device = makeDevice(
      baseClientConfig({
        security: {
          securityPolicy: 'Basic256Sha256',
          securityMode: 'SignAndEncrypt',
          authMode: 'username',
          username: 'operator',
          password: 'secret',
          clientCertPem: null,
          clientKeyPem: null,
          serverCertPem: null,
        },
      }),
    )
    const json = generateOpcUaClientConfig([device], debugMapJson([]), [])!
    const parsed = JSON.parse(json) as Array<{
      config: { servers: Array<{ security: Record<string, unknown> }> }
    }>
    expect(parsed[0].config.servers[0].security).toEqual({
      security_policy: 'Basic256Sha256',
      security_mode: 'SignAndEncrypt',
      auth_mode: 'username',
      username: 'operator',
      password: 'secret',
      client_cert_pem: null,
      client_key_pem: null,
      server_cert_pem: null,
    })
  })

  it('aggregates multiple enabled client devices into servers[]', () => {
    const a = makeDevice(baseClientConfig({ mappings: [makeMapping()] }), 'A')
    const b = makeDevice(
      baseClientConfig({ endpointUrl: 'opc.tcp://other:4840/y', mappings: [makeMapping()] }),
      'B',
    )
    const json = generateOpcUaClientConfig(
      [a, b],
      debugMapJson([{ path: 'COUNTER', type: 'INT', arr: 0, elem: 0, size: 2 }]),
      [],
    )!
    const parsed = JSON.parse(json) as Array<{ config: { servers: Array<{ name: string }> } }>
    expect(parsed[0].config.servers.map((s) => s.name)).toEqual(['A', 'B'])
  })

  it('throws OpcUaConfigError when a mapping local variable cannot be resolved', () => {
    const device = makeDevice(baseClientConfig({ mappings: [makeMapping({ variablePath: 'MISSING' })] }))
    expect(() =>
      generateOpcUaClientConfig(
        [device],
        debugMapJson([{ path: 'COUNTER', type: 'INT', arr: 0, elem: 0 }]),
        instances,
      ),
    ).toThrow(OpcUaConfigError)
  })
})

// ---------------------------------------------------------------------------
// validateOpcUaClientConfig
// ---------------------------------------------------------------------------

describe('validateOpcUaClientConfig', () => {
  it('is valid for a resolvable anonymous config', () => {
    const config = baseClientConfig({ mappings: [makeMapping()] })
    const result = validateOpcUaClientConfig(
      config,
      debugMapJson([{ path: 'COUNTER', type: 'INT', arr: 0, elem: 0 }]),
      [],
    )
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('flags username auth without a username', () => {
    const config = baseClientConfig({
      security: { ...baseSecurity(), authMode: 'username', username: null },
    })
    const result = validateOpcUaClientConfig(config, debugMapJson([]), [])
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.toLowerCase().includes('username'))).toBe(true)
  })

  it('flags certificate auth without a client certificate', () => {
    const config = baseClientConfig({
      security: { ...baseSecurity(), authMode: 'certificate' },
    })
    const result = validateOpcUaClientConfig(config, debugMapJson([]), [])
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.toLowerCase().includes('certificate'))).toBe(true)
  })

  it('flags an empty endpoint URL', () => {
    const config = baseClientConfig({ endpointUrl: '' })
    const result = validateOpcUaClientConfig(config, debugMapJson([]), [])
    expect(result.valid).toBe(false)
  })

  it('flags an unresolvable mapping', () => {
    const config = baseClientConfig({ mappings: [makeMapping({ variablePath: 'MISSING' })] })
    const result = validateOpcUaClientConfig(
      config,
      debugMapJson([{ path: 'COUNTER', type: 'INT', arr: 0, elem: 0 }]),
      instances,
    )
    expect(result.valid).toBe(false)
  })
})
