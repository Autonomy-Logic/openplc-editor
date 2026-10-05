/**
 * `check --protocols` answers "which plugins will be on", and the runtime has
 * no endpoint that answers it. These assertions are the whole basis for that
 * claim, so they pin the exact conf set per project shape.
 */

import type { PLCProjectData, PLCRemoteDevice, PLCServer } from '@root/middleware/shared/ports/types'

import { describeProtocolConfs } from '../check/protocol-confs'

const project = (servers: PLCServer[], remoteDevices: PLCRemoteDevice[] = []): PLCProjectData =>
  ({
    servers,
    remoteDevices,
    configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
    pous: [],
    dataTypes: [],
  }) as unknown as PLCProjectData

const modbus = (name: string, enabled: boolean): PLCServer => ({
  name,
  protocol: 'modbus-tcp',
  modbusSlaveConfig: { enabled, networkInterface: '0.0.0.0', port: 502 },
})

const s7 = (name: string, enabled: boolean): PLCServer => ({
  name,
  protocol: 's7comm',
  s7commSlaveConfig: {
    server: {
      enabled,
      bindAddress: '0.0.0.0',
      port: 102,
      maxClients: 8,
      workIntervalMs: 100,
      sendTimeoutMs: 3000,
      recvTimeoutMs: 3000,
      pingTimeoutMs: 10000,
      pduSize: 480,
    },
    dataBlocks: [],
  },
})

const enabledConfs = (data: PLCProjectData) => {
  const result = describeProtocolConfs(data, '', () => undefined)
  if (!result.ok) throw new Error(`expected confs, got: ${result.error}`)
  return Object.entries(result.confs)
    .filter(([, summary]) => summary.enabled)
    .map(([name]) => name)
    .sort()
}

describe('which conf files an upload would carry', () => {
  it('carries none for a project with no protocols', () => {
    expect(enabledConfs(project([]))).toEqual([])
  })

  it('carries modbus_slave for an enabled Modbus server', () => {
    expect(enabledConfs(project([modbus('A', true)]))).toEqual(['modbusSlave'])
  })

  it('carries nothing for a DISABLED Modbus server', () => {
    // The conf file IS the switch: shipping it opens port 502 on a device
    // meant to have it closed.
    expect(enabledConfs(project([modbus('A', false)]))).toEqual([])
  })

  it('carries s7comm even when the server is disabled', () => {
    // By design — that plugin reads `enabled` itself and declines to serve.
    expect(enabledConfs(project([s7('S', false)]))).toEqual(['s7comm'])
  })

  it('carries no ethercat.json when the project has no EtherCAT devices', () => {
    // It used to be written unconditionally, which enabled the native plugin
    // on every upload.
    expect(enabledConfs(project([modbus('A', true)], []))).not.toContain('ethercat')
  })

  it('carries no modbus_master for a device with no I/O groups', () => {
    const empty: PLCRemoteDevice = {
      name: 'Empty',
      protocol: 'modbus-tcp',
      modbusTcpConfig: { transport: 'tcp', host: '10.0.0.1', port: 502, timeout: 1000, ioGroups: [] },
    }
    expect(enabledConfs(project([], [empty]))).toEqual([])
  })

  it('reports the reason instead of throwing when a generator refuses', () => {
    const broken: PLCRemoteDevice = {
      name: 'Bus',
      protocol: 'ethercat',
      ethercatConfig: {
        masterConfig: { networkInterface: 'eth0', cycleTimeUs: 1000 },
        devices: [{ name: 'NoConfig', channelMappings: [] }],
      },
    } as unknown as PLCRemoteDevice
    const result = describeProtocolConfs(project([], [broken]), '', () => undefined)
    expect(result.ok).toBe(false)
  })
})
