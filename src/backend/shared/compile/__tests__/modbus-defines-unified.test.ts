/**
 * Equivalence between the retired VPP Modbus screen and the unified server
 * configuration that replaced it (DOPE-442).
 *
 * The firmware contract is a set of macro names `ModbusSlave.cpp` reads, so the
 * only question that matters about the move is whether the same project emits
 * the same macros. Every case here feeds one legacy `vendorScreenData` state
 * through both paths — straight into the emitter, and migrated into the new
 * model and back out through the adapter — and asserts the outputs match.
 *
 * The same comparison covers the debug baud and the debug slave id, where a
 * divergence would not break the build at all: it would make Connect report
 * "No Firmware Detected" on a healthy board.
 */

import type { VppModbusScreenState } from '../../../../frontend/utils/modbus/serial-link-config'
import {
  migrateVendorScreenModbus,
  vppStateFromModbusSlaveConfig,
} from '../../../../frontend/utils/modbus/serial-link-config'
import { generateModbusDefines, resolveDebugBaud, resolveDebugSlave } from '../steps/modbus-defines'

/** Legacy screen states, one per branch the emitter can take. */
const LEGACY_STATES: Record<string, Record<string, unknown>> = {
  'rtu on the default port': {
    modbus_rtu: {
      enabled: true,
      rtu_interface: 'Serial',
      rtu_baud_rate: '19200',
      rtu_slave_id: 7,
      enable_rs485_en_pin: false,
    },
  },
  'rtu on a secondary port': {
    modbus_rtu: { enabled: true, rtu_interface: 'Serial2', rtu_baud_rate: '57600', rtu_slave_id: 3 },
  },
  'rtu with an rs485 driver-enable pin': {
    modbus_rtu: {
      enabled: true,
      rtu_interface: 'Serial',
      rtu_baud_rate: '115200',
      rtu_slave_id: 1,
      enable_rs485_en_pin: true,
      rtu_rs485_en_pin: 'D5',
    },
  },
  'rtu asking for rs485 without naming a pin': {
    modbus_rtu: { enabled: true, enable_rs485_en_pin: true },
  },
  'rtu toggled on and nothing else touched': {
    modbus_rtu: { enabled: true },
  },
  'rtu left off but configured': {
    modbus_rtu: { enabled: false, rtu_interface: 'Serial1', rtu_baud_rate: '9600', rtu_slave_id: 42 },
  },
  'tcp over ethernet with a static host': {
    modbus_tcp: {
      enabled: true,
      tcp_interface: 'Ethernet',
      tcp_mac_address: 'de:ad:be:ef:fe:ed',
      enable_dhcp: false,
      ip_address: '192.168.0.50',
      gateway: '192.168.0.1',
      subnet: '255.255.255.0',
      dns: '8.8.8.8',
    },
  },
  'tcp over ethernet on dhcp': {
    modbus_tcp: { enabled: true, tcp_interface: 'Ethernet', enable_dhcp: true },
  },
  'tcp over wifi': {
    modbus_tcp: {
      enabled: true,
      tcp_interface: 'Wi-Fi',
      tcp_wifi_ssid: 'plant-floor',
      tcp_wifi_password: 'hunter2',
      enable_dhcp: true,
    },
  },
  'tcp toggled on and nothing else touched': {
    modbus_tcp: { enabled: true },
  },
  'both transports on': {
    modbus_rtu: { enabled: true, rtu_interface: 'Serial', rtu_baud_rate: '115200', rtu_slave_id: 2 },
    modbus_tcp: { enabled: true, tcp_interface: 'Wi-Fi', tcp_wifi_ssid: 'shopfloor', enable_dhcp: true },
  },
  'neither transport on': {
    modbus_rtu: { enabled: false },
    modbus_tcp: { enabled: false },
  },
  // A hand-edited project can name a static host without stating the flag that
  // selects it. The emitter reads a missing `enable_dhcp` as "not DHCP", so the
  // migration has to reach the same conclusion or the address is dropped.
  'static host with no dhcp flag at all': {
    modbus_tcp: {
      enabled: true,
      tcp_interface: 'Ethernet',
      ip_address: '10.0.0.7',
      gateway: '10.0.0.1',
      subnet: '255.255.255.0',
    },
  },
}

const throughNewModel = (legacy: Record<string, unknown>): VppModbusScreenState => {
  const migrated = migrateVendorScreenModbus(legacy)
  if (!migrated) throw new Error('nothing migrated')
  return vppStateFromModbusSlaveConfig({
    enabled: true,
    networkInterface: '0.0.0.0',
    port: 502,
    rtu: migrated.rtu,
    tcpLink: migrated.tcpLink,
  })
}

describe.each(Object.entries(LEGACY_STATES))('%s', (_name, legacy) => {
  const legacyState = legacy as VppModbusScreenState
  const unifiedState = throughNewModel(legacy)

  it('emits the same defines.h block', () => {
    expect(generateModbusDefines(unifiedState)).toBe(generateModbusDefines(legacyState))
  })

  it('resolves the same debug baud', () => {
    expect(resolveDebugBaud(unifiedState)).toBe(resolveDebugBaud(legacyState))
  })

  it('resolves the same debug slave id', () => {
    expect(resolveDebugSlave(unifiedState)).toBe(resolveDebugSlave(legacyState))
  })
})

describe('vppStateFromModbusSlaveConfig', () => {
  it('describes no transport when the server has neither block', () => {
    expect(vppStateFromModbusSlaveConfig(undefined)).toEqual({})
    expect(vppStateFromModbusSlaveConfig({ enabled: true, networkInterface: '0.0.0.0', port: 502 })).toEqual({})
    // An absent block means "this target has no serial slave", which is not the
    // same as one configured and switched off — so nothing is emitted for it.
    expect(generateModbusDefines(vppStateFromModbusSlaveConfig(undefined))).toBe('')
  })

  it('maps the medium onto the label the emitter switches on', () => {
    const link = {
      enabled: true,
      medium: 'wifi' as const,
      macAddress: '',
      wifiSsid: 'floor',
      wifiPassword: 'pw',
      useDhcp: true,
      ipAddress: '',
      gateway: '',
      subnet: '',
      dns: '',
    }
    const state = vppStateFromModbusSlaveConfig({
      enabled: true,
      networkInterface: '0.0.0.0',
      port: 502,
      tcpLink: link,
    })

    expect(state.modbus_tcp?.tcp_interface).toBe('Wi-Fi')
    expect(generateModbusDefines(state)).toContain('#define MBTCP_WIFI')
    expect(
      generateModbusDefines({ ...state, modbus_tcp: { ...state.modbus_tcp, tcp_interface: 'Ethernet' } }),
    ).toContain('#define MBTCP_ETHERNET')
  })
})
