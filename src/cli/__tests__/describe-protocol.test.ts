/**
 * `describe` output ends up in logs and diffs, so the two secrets OPC-UA stores
 * must not be in it — and `apply` has to put them back, or the first round trip
 * destroys the server's private key.
 */

import type { PLCRemoteDevice, PLCServer } from '@root/middleware/shared/ports/types'

import { describeProtocols } from '../describe/protocol'

const opcUa: PLCServer = {
  name: 'Ua',
  protocol: 'opcua',
  opcuaServerConfig: {
    server: {
      enabled: true,
      name: 'Server',
      applicationUri: 'urn:a',
      productUri: 'urn:b',
      bindAddress: '0.0.0.0',
      port: 4840,
      endpointPath: '/openplc/opcua',
    },
    securityProfiles: [],
    security: {
      serverCertificateStrategy: 'custom',
      serverCertificateCustom: 'PUBLIC CERT',
      serverPrivateKeyCustom: 'THE PRIVATE KEY',
      trustedClientCertificates: [],
    },
    users: [
      { id: 'u1', type: 'password', username: 'op', passwordHash: 'THE HASH', certificateId: null, role: 'operator' },
    ],
    cycleTimeMs: 100,
    addressSpace: { namespaceUri: 'urn:ns', nodes: [] },
  },
}

const fieldIo: PLCRemoteDevice = {
  name: 'FieldIO',
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
        functionCode: '2',
        cycleTime: 100,
        offset: '0x0000',
        length: 3,
        errorHandling: 'keep-last-value',
        ioPoints: [
          { id: 'p0', name: 'A_0', type: 'Digital Input', iecLocation: '%IX0.0', alias: 'fStart' },
          { id: 'p1', name: 'A_1', type: 'Digital Input', iecLocation: '%IX0.1' },
          { id: 'p2', name: 'A_2', type: 'Digital Input', iecLocation: '%IX0.2', alias: 'fStop' },
        ],
      },
    ],
  },
}

describe('describing an OPC-UA server', () => {
  const described = describeProtocols([opcUa], [])
  const serialized = JSON.stringify(described.servers)

  it('leaves the private key and every password hash out', () => {
    expect(serialized).not.toContain('THE PRIVATE KEY')
    expect(serialized).not.toContain('THE HASH')
  })

  it('keeps the public certificate, which is not a secret', () => {
    expect(serialized).toContain('PUBLIC CERT')
  })

  it('hoists the enable flag out of its nested home', () => {
    expect(described.servers[0].enabled).toBe(true)
    expect(JSON.stringify(described.servers[0])).not.toContain('"enabled":true,"name":"Server"')
  })
})

describe('describing a Modbus master', () => {
  const described = describeProtocols([], [fieldIo])
  const group = (described.remoteDevices[0].modbus as { ioGroups: Record<string, unknown>[] }).ioGroups[0]

  it('emits the aliases, which are authored', () => {
    expect(group.aliases).toEqual(['fStart', '', 'fStop'])
  })

  it('leaves out the derived id and the allocated points', () => {
    expect('id' in group).toBe(false)
    expect('ioPoints' in group).toBe(false)
  })

  it('reports the allocated addresses outside the spec', () => {
    // Allocation decides these, so a spec carrying them would stop
    // round-tripping the moment allocation differed.
    expect(described.protocolAddresses).toEqual([
      { device: 'FieldIO', group: 'A', point: 'A_0', type: 'Digital Input', iecLocation: '%IX0.0', alias: 'fStart' },
      { device: 'FieldIO', group: 'A', point: 'A_1', type: 'Digital Input', iecLocation: '%IX0.1' },
      { device: 'FieldIO', group: 'A', point: 'A_2', type: 'Digital Input', iecLocation: '%IX0.2', alias: 'fStop' },
    ])
  })

  it('drops trailing unnamed points rather than padding the alias list', () => {
    const trailing = structuredClone(fieldIo)
    delete trailing.modbusTcpConfig!.ioGroups[0].ioPoints![2].alias
    const only = describeProtocols([], [trailing])
    const groups = (only.remoteDevices[0].modbus as { ioGroups: Record<string, unknown>[] }).ioGroups[0]
    expect(groups.aliases).toEqual(['fStart'])
  })
})
