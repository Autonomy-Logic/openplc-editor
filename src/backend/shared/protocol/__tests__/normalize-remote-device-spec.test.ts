/**
 * The error cases here are the ones the Modbus master generator drops WITHOUT
 * failing the compile: a device with no I/O groups and an RTU device with no
 * serial port both upload cleanly and then never poll anything.
 */

import { PLCRemoteDeviceSchema } from '../../types/PLC/open-plc'
import { normalizeRemoteDeviceSpec } from '../normalize-remote-device-spec'
import type { SpecRemoteDevice } from '../types'

const ok = (spec: SpecRemoteDevice) => {
  const result = normalizeRemoteDeviceSpec(spec)
  if (!result.ok) throw new Error(`expected ok, got: ${result.errors.join(' | ')}`)
  expect(PLCRemoteDeviceSchema.safeParse(result.value.device).success).toBe(true)
  return result.value
}

const errorsOf = (spec: SpecRemoteDevice) => {
  const result = normalizeRemoteDeviceSpec(spec)
  return result.ok ? [] : result.errors
}

describe('a Modbus TCP remote device', () => {
  it('builds from nothing but a name and a protocol', () => {
    const { device } = ok({ name: 'FieldIO', protocol: 'modbus-tcp' })
    expect(device.modbusTcpConfig).toMatchObject({
      transport: 'tcp',
      host: '127.0.0.1',
      port: 502,
      slaveId: 1,
      timeout: 1000,
      ioGroups: [],
    })
  })

  it('returns I/O groups beside the device, not inside it', () => {
    // The store allocates their points and addresses; a device carrying
    // pre-built groups would bypass that.
    const { device, ioGroups } = ok({
      name: 'FieldIO',
      protocol: 'modbus-tcp',
      modbus: {
        host: '10.0.0.5',
        ioGroups: [{ name: 'Inputs', functionCode: '2', cycleTime: 100, offset: '0x0000', length: 8 }],
      },
    })

    expect(device.modbusTcpConfig?.ioGroups).toEqual([])
    expect(ioGroups).toHaveLength(1)
    expect(ioGroups[0]).toMatchObject({ id: 'group-Inputs', length: 8, errorHandling: 'keep-last-value', ioPoints: [] })
  })

  it('accepts a single-element function code at length 1', () => {
    const { ioGroups } = ok({
      name: 'FieldIO',
      protocol: 'modbus-tcp',
      modbus: { ioGroups: [{ name: 'Trip', functionCode: '5', cycleTime: 100, offset: '0x0000', length: 1 }] },
    })
    expect(ioGroups[0].length).toBe(1)
  })

  it('refuses a longer one rather than silently truncating it', () => {
    // The GUI disables the Length field for FC 5/6, so this is only reachable
    // from a spec. Clamping to 1 would leave the author reading a config that
    // does not say what they wrote.
    expect(
      errorsOf({
        name: 'FieldIO',
        protocol: 'modbus-tcp',
        modbus: { ioGroups: [{ name: 'Trip', functionCode: '5', cycleTime: 100, offset: '0x0000', length: 9 }] },
      }).join(' '),
    ).toContain('FC 5 addresses at most 1')
  })

  it('refuses a group longer than its function code can request', () => {
    expect(
      errorsOf({
        name: 'FieldIO',
        protocol: 'modbus-tcp',
        modbus: { ioGroups: [{ name: 'Big', functionCode: '3', cycleTime: 100, offset: '0x0000', length: 200 }] },
      }).join(' '),
    ).toContain('at most 125')
  })

  it('refuses two groups with the same name', () => {
    expect(
      errorsOf({
        name: 'FieldIO',
        protocol: 'modbus-tcp',
        modbus: {
          ioGroups: [
            { name: 'Inputs', functionCode: '2', cycleTime: 100, offset: '0x0000', length: 8 },
            { name: 'inputs', functionCode: '1', cycleTime: 100, offset: '0x0010', length: 8 },
          ],
        },
      }).join(' '),
    ).toContain('both named')
  })
})

describe('a Modbus RTU remote device', () => {
  it('builds when it has a serial port', () => {
    const { device } = ok({
      name: 'Serial',
      protocol: 'modbus-tcp',
      modbus: { transport: 'rtu', serialPort: '/dev/ttyUSB0', baudRate: 19200, parity: 'E', slaveId: 12 },
    })
    expect(device.modbusTcpConfig).toMatchObject({ transport: 'rtu', serialPort: '/dev/ttyUSB0', slaveId: 12 })
  })

  it('refuses one without a serial port, which the generator would drop silently', () => {
    expect(errorsOf({ name: 'Serial', protocol: 'modbus-tcp', modbus: { transport: 'rtu' } }).join(' ')).toContain(
      'needs a "serialPort"',
    )
  })

  it('refuses a slave id outside the RTU range', () => {
    expect(
      errorsOf({
        name: 'Serial',
        protocol: 'modbus-tcp',
        modbus: { transport: 'rtu', serialPort: '/dev/ttyUSB0', slaveId: 250 },
      }).join(' '),
    ).toContain('outside the RTU range 1..247')
  })

  it('allows that same slave id over TCP, where the range is wider', () => {
    const { device } = ok({ name: 'Wide', protocol: 'modbus-tcp', modbus: { slaveId: 250 } })
    expect(device.modbusTcpConfig?.slaveId).toBe(250)
  })
})

describe('an EtherCAT remote device', () => {
  it('builds a master with no slaves yet', () => {
    const { device } = ok({ name: 'Bus', protocol: 'ethercat' })
    // The device screen's own defaults, field for field.
    expect(device.ethercatConfig?.masterConfig).toEqual({
      networkInterface: 'eth0',
      cycleTimeUs: 1000,
      watchdogTimeoutCycles: 3,
    })
    expect(device.ethercatConfig?.devices).toEqual([])
  })

  it('takes the master overrides the spec gives', () => {
    const { device } = ok({
      name: 'Bus',
      protocol: 'ethercat',
      ethercat: { master: { networkInterface: 'enp3s0', cycleTimeUs: 500 } },
    })
    expect(device.ethercatConfig?.masterConfig?.networkInterface).toBe('enp3s0')
    expect(device.ethercatConfig?.masterConfig?.cycleTimeUs).toBe(500)
    expect(device.ethercatConfig?.masterConfig?.watchdogTimeoutCycles).toBe(3)
  })

  it('lets a master be switched off', () => {
    const { device } = ok({ name: 'Bus', protocol: 'ethercat', ethercat: { master: { enabled: false } } })
    expect(device.ethercatConfig?.masterConfig?.enabled).toBe(false)
  })

  it('rejects a cycle time the authoritative schema bounds', () => {
    expect(
      errorsOf({ name: 'Bus', protocol: 'ethercat', ethercat: { master: { cycleTimeUs: 5 } } }).join(' '),
    ).toContain('cycleTimeUs')
  })
})

describe('what it refuses', () => {
  it.each(['ethernet-ip', 'profinet'])('refuses %s, which has no generator', (protocol) => {
    expect(errorsOf({ name: 'X', protocol: protocol as never }).join(' ')).toContain('no configuration surface')
  })

  it('refuses a config block belonging to the other protocol', () => {
    expect(errorsOf({ name: 'Bus', protocol: 'ethercat', modbus: { host: '1.2.3.4' } }).join(' ')).toContain(
      'that block is ignored',
    )
  })

  it('refuses a name that is not a legal identifier', () => {
    expect(errorsOf({ name: '2Field', protocol: 'modbus-tcp' }).join(' ')).toContain('not a legal name')
  })
})
