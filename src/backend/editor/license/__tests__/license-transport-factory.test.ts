import { ModbusTcpClient } from '../../modbus/modbus-client'
import { ModbusRtuClient } from '../../modbus/modbus-rtu-client'
import { WebSocketDebugTransport } from '../../../shared/debug/websocket-debug-transport'
import { buildLicenseTransport } from '../license-transport-factory'

describe('buildLicenseTransport', () => {
  it('defaults to RTU (serial) and needs a string port', () => {
    const r = buildLicenseTransport({ port: 'COM5', baudRate: 9600, slaveId: 2 }, 8443)
    expect('client' in r).toBe(true)
    if ('client' in r) expect(r.client).toBeInstanceOf(ModbusRtuClient)
  })

  it('builds a WebSocket transport for websocket + host + token', () => {
    const r = buildLicenseTransport({ connectionType: 'websocket', host: '1.2.3.4', token: 'jwt' }, 8443)
    expect('client' in r).toBe(true)
    if ('client' in r) expect(r.client).toBeInstanceOf(WebSocketDebugTransport)
  })

  it('builds a TCP transport for tcp + host', () => {
    const r = buildLicenseTransport({ connectionType: 'tcp', host: '1.2.3.4' }, 8443)
    expect('client' in r).toBe(true)
    if ('client' in r) expect(r.client).toBeInstanceOf(ModbusTcpClient)
  })

  it('errors when websocket has no token', () => {
    expect(buildLicenseTransport({ connectionType: 'websocket', host: '1.2.3.4' }, 8443)).toEqual({
      error: expect.stringContaining('token'),
    })
  })

  // Serial and TCP now defer to `buildDeviceModbusTransport`, so these assert
  // that the delegation reports ITS message rather than a second copy here.
  it('errors when tcp has no host', () => {
    expect(buildLicenseTransport({ connectionType: 'tcp' }, 8443)).toEqual({
      error: expect.stringContaining('IP address is required'),
    })
  })

  it('errors when rtu has no (string) port', () => {
    expect(buildLicenseTransport({}, 8443)).toEqual({ error: expect.stringContaining('serial port is required') })
    expect(buildLicenseTransport({ port: 502 }, 8443)).toEqual({
      error: expect.stringContaining('serial port is required'),
    })
  })
})
