/**
 * Every fixture here is a project that saves, compiles and uploads. The
 * negative cases carry as much weight as the positive ones: the collision rule
 * in particular fired on correct code the first time it met a real project,
 * because a global bound by ALIAS resolves to its device's own address.
 */

import type { PLCRemoteDevice, PLCServer, PLCVariable } from '@root/middleware/shared/ports/types'

import { lintProtocols } from '../lint/protocol'

const modbusServer = (name: string, enabled: boolean, port = 502): PLCServer => ({
  name,
  protocol: 'modbus-tcp',
  modbusSlaveConfig: { enabled, networkInterface: '0.0.0.0', port },
})

const device = (name: string, overrides: Partial<PLCRemoteDevice['modbusTcpConfig']> = {}): PLCRemoteDevice => ({
  name,
  protocol: 'modbus-tcp',
  modbusTcpConfig: {
    transport: 'tcp',
    host: '10.0.0.1',
    port: 502,
    timeout: 1000,
    ioGroups: [
      {
        id: 'group-A',
        name: 'A',
        functionCode: '1',
        cycleTime: 100,
        offset: '0x0000',
        length: 2,
        errorHandling: 'keep-last-value',
        ioPoints: [
          { id: 'p0', name: 'A_0', type: 'Digital Input', iecLocation: '%IX0.0' },
          { id: 'p1', name: 'A_1', type: 'Digital Input', iecLocation: '%IX0.1' },
        ],
      },
    ],
    ...overrides,
  },
})

const global = (name: string, location: string): PLCVariable =>
  ({ name, class: 'global', type: { definition: 'base-type', value: 'BOOL' }, location }) as PLCVariable

const rules = (input: { servers?: PLCServer[]; remoteDevices?: PLCRemoteDevice[]; globals?: PLCVariable[] }) =>
  lintProtocols({
    servers: input.servers ?? [],
    remoteDevices: input.remoteDevices ?? [],
    debugMapContent: '',
    instances: [],
    globals: input.globals ?? [],
  }).map((finding) => finding.rule)

describe('two servers of one protocol', () => {
  it('reports both enabled, because the runtime takes one config', () => {
    expect(rules({ servers: [modbusServer('A', true), modbusServer('B', true, 1502)] })).toContain(
      'duplicate-protocol-server',
    )
  })

  it('says nothing when only one is enabled', () => {
    expect(rules({ servers: [modbusServer('A', true), modbusServer('B', false, 1502)] })).toEqual([])
  })

  it('reports a port two enabled servers share', () => {
    const s7: PLCServer = {
      name: 'S7',
      protocol: 's7comm',
      s7commSlaveConfig: {
        server: {
          enabled: true,
          bindAddress: '0.0.0.0',
          port: 502,
          maxClients: 8,
          workIntervalMs: 100,
          sendTimeoutMs: 3000,
          recvTimeoutMs: 3000,
          pingTimeoutMs: 10000,
          pduSize: 480,
        },
        dataBlocks: [],
      },
    }
    expect(rules({ servers: [modbusServer('A', true), s7] })).toContain('server-port-conflict')
  })
})

describe('a remote device the generator would drop', () => {
  it('reports one with no I/O groups', () => {
    expect(rules({ remoteDevices: [device('Empty', { ioGroups: [] })] })).toContain('modbus-device-without-io-groups')
  })

  it('reports RTU with no serial port', () => {
    expect(rules({ remoteDevices: [device('Serial', { transport: 'rtu' })] })).toContain(
      'modbus-rtu-without-serial-port',
    )
  })

  it('says nothing about a complete TCP device', () => {
    expect(rules({ remoteDevices: [device('Good')] })).toEqual([])
  })
})

describe('a located global sharing an address with a device', () => {
  it('reports a literal address the allocator also handed out', () => {
    // The allocator's pool is built from the pin mapping, VPP and the remote
    // devices — never from a global's hand-written location.
    expect(rules({ remoteDevices: [device('Field')], globals: [global('gStart', '%IX0.0')] })).toContain(
      'located-global-collides-with-remote-io',
    )
  })

  it('does NOT report a global bound to the point by ALIAS', () => {
    // This is the intended way to read a polled value, and reporting it taught
    // the linter to be ignored the first time it met a real project.
    expect(rules({ remoteDevices: [device('Field')], globals: [global('fCoil0', 'fCoil0')] })).toEqual([])
  })

  it('does NOT report a different storage class at the same index', () => {
    // `bool_input` and `int_input` are separate arrays in the runtime, so
    // %IX0.0 and %IW0 are not the same storage.
    expect(rules({ remoteDevices: [device('Field')], globals: [global('gLevel', '%IW0')] })).toEqual([])
  })

  it('does NOT report an address no device claims', () => {
    expect(rules({ remoteDevices: [device('Field')], globals: [global('gSpare', '%IX10.0')] })).toEqual([])
  })

  it('treats a bitless bit address as bit 0', () => {
    expect(rules({ remoteDevices: [device('Field')], globals: [global('gStart', '%IX0')] })).toContain(
      'located-global-collides-with-remote-io',
    )
  })
})

describe('an EtherCAT bus', () => {
  // The stored shape: the generator dereferences every one of these.
  const slaveConfig = {
    startupChecks: { checkVendorId: true, checkProductCode: true },
    addressing: { ethercatAddress: 1001 },
    timeouts: { sdoTimeoutMs: 1000, initToPreOpTimeoutMs: 3000, safeOpToOpTimeoutMs: 10000 },
    watchdog: { smWatchdogEnabled: true, smWatchdogMs: 100, pdiWatchdogEnabled: true, pdiWatchdogMs: 100 },
    distributedClocks: {
      dcEnabled: false,
      dcSyncUnitCycleUs: 0,
      dcSync0Enabled: false,
      dcSync0CycleUs: 0,
      dcSync0ShiftUs: 0,
      dcSync1Enabled: false,
      dcSync1CycleUs: 0,
      dcSync1ShiftUs: 0,
    },
  }

  const slave = (name: string, channelMappings: unknown[]) => ({
    id: name,
    name,
    position: 0,
    esiDeviceRef: { repositoryItemId: 'file', deviceIndex: 0 },
    vendorId: '0x1',
    productCode: '0x2',
    revisionNo: '0x3',
    addedFrom: 'repository',
    config: slaveConfig,
    channelMappings,
  })

  const bus = (devices: unknown[]): PLCRemoteDevice =>
    ({
      name: 'Bus',
      protocol: 'ethercat',
      ethercatConfig: { masterConfig: { networkInterface: 'eth0', cycleTimeUs: 1000 }, devices },
    }) as PLCRemoteDevice

  it('reports a master with no slaves', () => {
    expect(rules({ remoteDevices: [bus([])] })).toContain('ethercat-master-without-slaves')
  })

  it('reports a slave with no channel mappings', () => {
    expect(rules({ remoteDevices: [bus([slave('Axis1', [])])] })).toContain('ethercat-slave-without-channels')
  })

  it('says nothing about a slave that exchanges data', () => {
    const wired = bus([slave('Axis1', [{ channelId: 'c0', iecLocation: '%IW4' }])])
    expect(rules({ remoteDevices: [wired] })).toEqual([])
  })

  it('reports rather than crashes when the generator cannot build the config', () => {
    // `check` running the linter must survive a project shape the generator
    // dereferences without a guard.
    const broken = bus([{ name: 'NoConfig', channelMappings: [{ channelId: 'c0', iecLocation: '%IW4' }] }])
    expect(rules({ remoteDevices: [broken] })).toContain('ethercat-config-invalid')
  })
})

describe('an OPC-UA server left on the shipped profile', () => {
  const opcuaServer = (profiles: { enabled: boolean; policy: string; mode: string; auth: string[] }[]): PLCServer =>
    ({
      name: 'OPC',
      protocol: 'opc-ua',
      opcuaServerConfig: {
        server: {
          enabled: true,
          name: 'OpenPLC OPC UA Server',
          applicationUri: 'urn:openplc:opcua:server',
          productUri: 'urn:openplc:runtime',
          bindAddress: '0.0.0.0',
          port: 4840,
          endpointPath: '/openplc/opcua',
        },
        securityProfiles: profiles.map((profile, index) => ({
          id: `profile-${index}`,
          name: `profile-${index}`,
          enabled: profile.enabled,
          securityPolicy: profile.policy,
          securityMode: profile.mode,
          authMethods: profile.auth,
        })),
        security: {
          serverCertificateStrategy: 'auto_self_signed',
          serverCertificateCustom: null,
          serverPrivateKeyCustom: null,
          trustedClientCertificates: [],
        },
        users: [],
        cycleTimeMs: 100,
        addressSpace: { namespaceUri: 'urn:openplc:opcua:namespace', nodes: [] },
      },
    }) as unknown as PLCServer

  const anonymous = { enabled: true, policy: 'None', mode: 'None', auth: ['Anonymous'] }
  const signed = { enabled: true, policy: 'Basic256Sha256', mode: 'SignAndEncrypt', auth: ['UserName'] }

  it('warns when the only enabled profile is the shipped anonymous one', () => {
    expect(rules({ servers: [opcuaServer([anonymous])] })).toContain('opcua-server-unauthenticated')
  })

  it('stays quiet once a real profile is enabled alongside it', () => {
    expect(rules({ servers: [opcuaServer([anonymous, signed])] })).not.toContain('opcua-server-unauthenticated')
  })

  it('stays quiet when the anonymous profile is disabled', () => {
    expect(rules({ servers: [opcuaServer([{ ...anonymous, enabled: false }, signed])] })).not.toContain(
      'opcua-server-unauthenticated',
    )
  })

  it('says the address and port, which is what makes the warning actionable', () => {
    const finding = lintProtocols({
      servers: [opcuaServer([anonymous])],
      remoteDevices: [],
      debugMapContent: '',
      instances: [],
      globals: [],
    }).find((f) => f.rule === 'opcua-server-unauthenticated')
    expect(finding?.message).toContain('0.0.0.0:4840')
    expect(finding?.severity).toBe('warning')
  })
})
