import { PLCRemoteDeviceSchema } from '../open-plc'

const deviceFile = (config: Record<string, unknown>): unknown => ({
  name: 'Pump',
  protocol: 'modbus-tcp',
  modbusTcpConfig: { transport: 'tcp', host: '192.168.1.20', port: 502, timeout: 1000, ioGroups: [], ...config },
})

describe('loading a Modbus remote device file', () => {
  it('keeps Reconnect checked', () => {
    expect(PLCRemoteDeviceSchema.parse(deviceFile({ reconnect: true })).modbusTcpConfig?.reconnect).toBe(true)
  })

  it('keeps Reconnect unchecked', () => {
    expect(PLCRemoteDeviceSchema.parse(deviceFile({ reconnect: false })).modbusTcpConfig?.reconnect).toBe(false)
  })

  it('leaves the key absent for a file saved before the option existed', () => {
    const config = PLCRemoteDeviceSchema.parse(deviceFile({})).modbusTcpConfig
    expect(config).toBeDefined()
    expect(Object.keys(config ?? {})).not.toContain('reconnect')
  })

  it('refuses a Reconnect value that is not a boolean', () => {
    expect(PLCRemoteDeviceSchema.safeParse(deviceFile({ reconnect: 'yes' })).success).toBe(false)
  })
})
