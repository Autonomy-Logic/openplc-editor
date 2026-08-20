import {
  clampSlaveId,
  DEFAULT_MODBUS_RTU,
  DEFAULT_MODBUS_TCP_LINK,
  migrateVendorScreenModbus,
  resolveModbusRtu,
  resolveModbusTcpLink,
} from '../serial-link-config'

describe('defaults', () => {
  // These mirror the retired screens/modbus.json field for field. A project
  // that never opened that screen has to resolve to what it would have shown.
  it('match the screen definition they replaced', () => {
    expect(DEFAULT_MODBUS_RTU).toEqual({
      enabled: false,
      serialPort: 'Serial',
      baudRate: '115200',
      slaveId: 1,
      useRs485EnPin: false,
      rs485EnPin: '',
    })
    expect(DEFAULT_MODBUS_TCP_LINK).toEqual({
      enabled: false,
      medium: 'ethernet',
      macAddress: '',
      wifiSsid: '',
      wifiPassword: '',
      useDhcp: true,
      ipAddress: '',
      gateway: '',
      subnet: '',
      dns: '',
    })
  })
})

describe('resolveModbusRtu / resolveModbusTcpLink', () => {
  it('fill in everything the caller left out', () => {
    expect(resolveModbusRtu()).toEqual(DEFAULT_MODBUS_RTU)
    expect(resolveModbusTcpLink()).toEqual(DEFAULT_MODBUS_TCP_LINK)
    expect(resolveModbusRtu({})).toEqual(DEFAULT_MODBUS_RTU)
    expect(resolveModbusTcpLink({})).toEqual(DEFAULT_MODBUS_TCP_LINK)
  })

  it('keep the fields the caller did state', () => {
    expect(resolveModbusRtu({ enabled: true, baudRate: '9600' })).toEqual({
      ...DEFAULT_MODBUS_RTU,
      enabled: true,
      baudRate: '9600',
    })
    expect(resolveModbusTcpLink({ medium: 'wifi', useDhcp: false })).toEqual({
      ...DEFAULT_MODBUS_TCP_LINK,
      medium: 'wifi',
      useDhcp: false,
    })
  })
})

describe('clampSlaveId', () => {
  it('holds the id inside the range the protocol addresses', () => {
    // 0 is broadcast and 248-255 are reserved, so neither addresses a slave.
    expect(clampSlaveId(0)).toBe(1)
    expect(clampSlaveId(-5)).toBe(1)
    expect(clampSlaveId(248)).toBe(247)
    expect(clampSlaveId(9000)).toBe(247)
    expect(clampSlaveId(1)).toBe(1)
    expect(clampSlaveId(247)).toBe(247)
    expect(clampSlaveId(12)).toBe(12)
  })

  it('drops a fractional part rather than rounding into a neighbour', () => {
    expect(clampSlaveId(12.9)).toBe(12)
  })
})

describe('migrateVendorScreenModbus', () => {
  it('says nothing to migrate when the screen was never persisted', () => {
    expect(migrateVendorScreenModbus(undefined)).toBeNull()
    expect(migrateVendorScreenModbus({})).toBeNull()
    expect(migrateVendorScreenModbus({ 'io-mapping': { some: 'other screen' } })).toBeNull()
  })

  it('reads the spellings the shipped packages persisted', () => {
    const migrated = migrateVendorScreenModbus({
      modbus_rtu: {
        enabled: true,
        rtu_interface: 'Serial2',
        rtu_baud_rate: '19200',
        rtu_slave_id: 7,
        enable_rs485_en_pin: true,
        rtu_rs485_en_pin: 'D5',
      },
      modbus_tcp: {
        enabled: true,
        tcp_interface: 'Wi-Fi',
        tcp_wifi_ssid: 'plant-floor',
        tcp_wifi_password: 'hunter2',
        enable_dhcp: false,
        ip_address: '192.168.0.50',
        gateway: '192.168.0.1',
        subnet: '255.255.255.0',
        dns: '8.8.8.8',
      },
    })

    expect(migrated).toEqual({
      rtu: {
        enabled: true,
        serialPort: 'Serial2',
        baudRate: '19200',
        slaveId: 7,
        useRs485EnPin: true,
        rs485EnPin: 'D5',
      },
      tcpLink: {
        enabled: true,
        medium: 'wifi',
        macAddress: '',
        wifiSsid: 'plant-floor',
        wifiPassword: 'hunter2',
        useDhcp: false,
        ipAddress: '192.168.0.50',
        gateway: '192.168.0.1',
        subnet: '255.255.255.0',
        dns: '8.8.8.8',
      },
    })
  })

  it('prefers the later serial_port / baud_rate spelling over the original one', () => {
    // The emitter accepted both, so a project can carry either — or, after a
    // partial edit, both at once. The later pair is the one that was written.
    const migrated = migrateVendorScreenModbus({
      modbus_rtu: {
        serial_port: 'Serial3',
        rtu_interface: 'Serial1',
        baud_rate: '57600',
        rtu_baud_rate: '9600',
      },
    })

    expect(migrated?.rtu.serialPort).toBe('Serial3')
    expect(migrated?.rtu.baudRate).toBe('57600')
  })

  it('migrates a section that is present alone', () => {
    const rtuOnly = migrateVendorScreenModbus({ modbus_rtu: { enabled: true } })
    expect(rtuOnly?.rtu.enabled).toBe(true)
    expect(rtuOnly?.tcpLink).toEqual(DEFAULT_MODBUS_TCP_LINK)

    const tcpOnly = migrateVendorScreenModbus({ modbus_tcp: { enabled: true } })
    expect(tcpOnly?.rtu).toEqual(DEFAULT_MODBUS_RTU)
    expect(tcpOnly?.tcpLink.enabled).toBe(true)
  })

  it('reads a slave id the number field persisted as text, and clamps it', () => {
    expect(migrateVendorScreenModbus({ modbus_rtu: { rtu_slave_id: '12' } })?.rtu.slaveId).toBe(12)
    expect(migrateVendorScreenModbus({ modbus_rtu: { rtu_slave_id: 0 } })?.rtu.slaveId).toBe(1)
    expect(migrateVendorScreenModbus({ modbus_rtu: { rtu_slave_id: 900 } })?.rtu.slaveId).toBe(247)
  })

  it('falls back to the default for anything it cannot trust', () => {
    // Hand-edited project files reach this function too, so every field is
    // read defensively rather than assumed to hold what the screen wrote.
    const migrated = migrateVendorScreenModbus({
      modbus_rtu: {
        enabled: 'yes',
        rtu_interface: 'Serial9',
        rtu_baud_rate: 300,
        rtu_slave_id: 'not a number',
        rtu_rs485_en_pin: 42,
      },
      modbus_tcp: {
        tcp_interface: 'Zigbee',
        ip_address: null,
        enable_dhcp: 1,
      },
    })

    expect(migrated?.rtu).toEqual(DEFAULT_MODBUS_RTU)
    expect(migrated?.tcpLink).toEqual(DEFAULT_MODBUS_TCP_LINK)
  })

  it('reads an empty slave id as unstated rather than as zero', () => {
    expect(migrateVendorScreenModbus({ modbus_rtu: { rtu_slave_id: '' } })?.rtu.slaveId).toBe(1)
  })

  it('survives a section that is not an object', () => {
    const migrated = migrateVendorScreenModbus({ modbus_rtu: null, modbus_tcp: 'corrupted' })

    expect(migrated?.rtu).toEqual(DEFAULT_MODBUS_RTU)
    expect(migrated?.tcpLink).toEqual(DEFAULT_MODBUS_TCP_LINK)
  })

  it('keeps a static host that never stated the DHCP flag', () => {
    // The emitter reads a missing `enable_dhcp` as "not DHCP" and emits the
    // address; defaulting to DHCP here would drop it from the firmware.
    const migrated = migrateVendorScreenModbus({
      modbus_tcp: { enabled: true, ip_address: '10.0.0.7', gateway: '10.0.0.1' },
    })

    expect(migrated?.tcpLink.useDhcp).toBe(false)
    expect(migrated?.tcpLink.ipAddress).toBe('10.0.0.7')
  })

  it('still defaults to DHCP when no host is named either', () => {
    expect(migrateVendorScreenModbus({ modbus_tcp: { enabled: true } })?.tcpLink.useDhcp).toBe(true)
  })

  it('honours an explicit DHCP flag over the inference', () => {
    const migrated = migrateVendorScreenModbus({
      modbus_tcp: { enabled: true, enable_dhcp: true, ip_address: '10.0.0.7' },
    })

    expect(migrated?.tcpLink.useDhcp).toBe(true)
  })

  it('maps the medium label the screen stored onto the model value', () => {
    expect(migrateVendorScreenModbus({ modbus_tcp: { tcp_interface: 'Ethernet' } })?.tcpLink.medium).toBe('ethernet')
    expect(migrateVendorScreenModbus({ modbus_tcp: { tcp_interface: 'Wi-Fi' } })?.tcpLink.medium).toBe('wifi')
  })
})
