/**
 * Promoting a pre-4.4.0 baremetal Modbus configuration to a real `PLCServer`.
 *
 * What is worth pinning here is what the migration must NOT do, since each one
 * is a way of silently changing a user's project on upgrade:
 *
 *  - it must not invent a server on a board that served nothing, because the
 *    package ships `modbus_rtu` and `modbus_tcp` on every board and their mere
 *    presence is not evidence anyone wanted a server (`BR05`);
 *  - it must not run twice, or reopening a project accumulates servers;
 *  - it must not overwrite a name already in use;
 *  - and it must carry the slave id and the wiring across, because losing them
 *    means the migrated board answers on a different address than the firmware
 *    already flashed onto it.
 */

import type { PLCServer } from '../../../../middleware/shared/ports/types'
import { MIGRATED_SERVER_NAME, planVendorModbusMigration } from '../migrate-vendor-modbus-to-server'

/** A board serving RTU, with the wiring already folded into `serial`. */
const RTU_PROJECT = {
  modbus_rtu: { enabled: true, rtu_slave_id: 7 },
  modbus_tcp: { enabled: false },
  serial: { modbus_port: 'Serial1', modbus_baud_rate: '19200' },
}

describe('planVendorModbusMigration', () => {
  it('returns null when the project has no vendor screen state at all', () => {
    expect(planVendorModbusMigration(undefined, [])).toBeNull()
  })

  it('does not invent a server on a board that served nothing', () => {
    const untouched = { modbus_rtu: { enabled: false }, modbus_tcp: { enabled: false } }
    expect(planVendorModbusMigration(untouched, [])).toBeNull()
  })

  it('treats a section that is present but never configured as serving nothing', () => {
    expect(planVendorModbusMigration({ modbus_rtu: {}, modbus_tcp: {} }, [])).toBeNull()
  })

  it('carries an RTU board across with its slave id and wiring', () => {
    const server = planVendorModbusMigration(RTU_PROJECT, [])

    expect(server?.name).toBe(MIGRATED_SERVER_NAME)
    expect(server?.protocol).toBe('modbus-tcp')
    expect(server?.modbusSlaveConfig).toMatchObject({
      enabled: true,
      transports: ['rtu'],
      slaveId: 7,
      serialPort: 'Serial1',
      baudRate: 19200,
    })
  })

  it('gives the firmware answers for the two fields baremetal does not let the user pick', () => {
    // `modbus_tcp.cpp` hard-codes 502 and binds every interface; carrying a
    // user choice here would be a control that changes nothing.
    const server = planVendorModbusMigration(RTU_PROJECT, [])
    expect(server?.modbusSlaveConfig?.port).toBe(502)
    expect(server?.modbusSlaveConfig?.networkInterface).toBe('0.0.0.0')
  })

  it('records both transports as one server, never two', () => {
    const both = { modbus_rtu: { enabled: true }, modbus_tcp: { enabled: true } }
    expect(planVendorModbusMigration(both, [])?.modbusSlaveConfig?.transports).toEqual(['rtu', 'tcp'])
  })

  it('records a TCP-only board', () => {
    const tcp = { modbus_rtu: { enabled: false }, modbus_tcp: { enabled: true } }
    expect(planVendorModbusMigration(tcp, [])?.modbusSlaveConfig?.transports).toEqual(['tcp'])
  })

  it('omits the wiring the project never stated rather than inventing defaults', () => {
    const bare = { modbus_rtu: { enabled: true } }
    const config = planVendorModbusMigration(bare, [])?.modbusSlaveConfig

    expect(config).not.toHaveProperty('slaveId')
    expect(config).not.toHaveProperty('serialPort')
    expect(config).not.toHaveProperty('baudRate')
  })

  it('reads a baud rate the screen stored as text', () => {
    const config = planVendorModbusMigration(RTU_PROJECT, [])?.modbusSlaveConfig
    expect(config?.baudRate).toBe(19200)
  })

  it('drops an unreadable number instead of carrying NaN into the emitted config', () => {
    const junk = { modbus_rtu: { enabled: true, rtu_slave_id: 'not a number' }, serial: { modbus_baud_rate: '' } }
    const config = planVendorModbusMigration(junk, [])?.modbusSlaveConfig

    expect(config).not.toHaveProperty('slaveId')
    expect(config).not.toHaveProperty('baudRate')
  })

  it('does nothing on a project already on the new model', () => {
    // Reopening must not accumulate mb_baremetal_server_2, _3, and so on.
    const migrated: PLCServer[] = [
      {
        name: 'anything',
        protocol: 'modbus-tcp',
        modbusSlaveConfig: { enabled: true, transports: ['rtu'], networkInterface: '0.0.0.0', port: 502 },
      },
    ]
    expect(planVendorModbusMigration(RTU_PROJECT, migrated)).toBeNull()
  })

  it('steps around a name already taken rather than overwriting it', () => {
    const taken: PLCServer[] = [
      { name: MIGRATED_SERVER_NAME, protocol: 'opcua' },
      { name: `${MIGRATED_SERVER_NAME}_2`, protocol: 'opcua' },
    ]
    expect(planVendorModbusMigration(RTU_PROJECT, taken)?.name).toBe(`${MIGRATED_SERVER_NAME}_3`)
  })

  it('is not fooled by a section that is not an object', () => {
    expect(planVendorModbusMigration({ modbus_rtu: 'enabled', modbus_tcp: null }, [])).toBeNull()
  })
})
