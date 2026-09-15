import { migrateModbusSerialFields } from '../migrate-modbus-serial-fields'

/** Every board is split unless a test says otherwise. */
const split = () => true
const notSplit = () => false

describe('migrateModbusSerialFields', () => {
  it('leaves an absent archive alone', () => {
    expect(migrateModbusSerialFields(undefined, split)).toBeUndefined()
  })

  it('moves the original single-screen spellings onto the serial section', () => {
    const before = {
      'ESP32 WROOM': {
        modbus_rtu: {
          enabled: true,
          rtu_slave_id: 7,
          rtu_interface: 'Serial2',
          rtu_baud_rate: '19200',
          enable_rs485_en_pin: true,
          rtu_rs485_en_pin: '4',
        },
      },
    }
    const after = migrateModbusSerialFields(before, split)

    expect(after?.['ESP32 WROOM'].serial).toEqual({
      modbus_port: 'Serial2',
      modbus_baud_rate: '19200',
      enable_rs485_en_pin: true,
      rs485_en_pin: '4',
    })
    // The two the native screen renders stay put.
    expect(after?.['ESP32 WROOM'].modbus_rtu).toEqual({ enabled: true, rtu_slave_id: 7 })
  })

  it('moves the first-split spellings too', () => {
    const after = migrateModbusSerialFields(
      { Board: { modbus_rtu: { enabled: true, serial_port: 'Serial1', baud_rate: '38400' } } },
      split,
    )
    expect(after?.Board.serial).toEqual({ modbus_port: 'Serial1', modbus_baud_rate: '38400' })
  })

  it('keeps an existing serial-section value and drops the stale key', () => {
    // A value written through the new screen is the user's latest intent; the
    // legacy key is stale by definition.
    const after = migrateModbusSerialFields(
      {
        Board: {
          serial: { baud_rate: '9600', modbus_port: 'Serial1' },
          modbus_rtu: { enabled: true, rtu_interface: 'Serial2' },
        },
      },
      split,
    )
    expect(after?.Board.serial).toEqual({ baud_rate: '9600', modbus_port: 'Serial1' })
    expect(after?.Board.modbus_rtu).toEqual({ enabled: true })
  })

  it('prefers the newer spelling when a project carries both, and leaves neither behind', () => {
    // Leaving one behind would let the compiler's fallback pick it up on a
    // later build, after the screen had stopped showing it.
    const after = migrateModbusSerialFields(
      { Board: { modbus_rtu: { serial_port: 'Serial1', rtu_interface: 'Serial3' } } },
      split,
    )
    expect(after?.Board.serial).toEqual({ modbus_port: 'Serial1' })
    expect(after?.Board.modbus_rtu).toEqual({})
  })

  it('does not touch a board whose installed package is still unsplit', () => {
    // That board still renders the old Modbus screen, which reads
    // modbus_rtu.rtu_interface directly. Migrating would mirror the bug: the
    // legacy screen would show its default while the build used the new key.
    const before = { Legacy: { modbus_rtu: { enabled: true, rtu_interface: 'Serial2' } } }
    expect(migrateModbusSerialFields(before, notSplit)).toBe(before)
  })

  it('migrates only the split boards in a mixed archive', () => {
    const after = migrateModbusSerialFields(
      {
        Split: { modbus_rtu: { rtu_interface: 'Serial1' } },
        Legacy: { modbus_rtu: { rtu_interface: 'Serial2' } },
      },
      (board) => board === 'Split',
    )
    expect(after?.Split.serial).toEqual({ modbus_port: 'Serial1' })
    expect(after?.Legacy).toEqual({ modbus_rtu: { rtu_interface: 'Serial2' } })
  })

  it('is idempotent', () => {
    const once = migrateModbusSerialFields({ Board: { modbus_rtu: { rtu_interface: 'Serial2' } } }, split)
    const twice = migrateModbusSerialFields(once, split)
    // Same object back: a second pass finds nothing to move, so the caller can
    // skip the state write and the project is not dirtied on every open.
    expect(twice).toBe(once)
  })

  it('returns the input unchanged when there is nothing to migrate', () => {
    const before = { Board: { serial: { baud_rate: '9600' }, modbus_rtu: { enabled: true, rtu_slave_id: 1 } } }
    expect(migrateModbusSerialFields(before, split)).toBe(before)
  })

  it('leaves a bucket with no modbus_rtu section alone', () => {
    const before = { Board: { network: { enabled: true } } }
    expect(migrateModbusSerialFields(before, split)).toBe(before)
  })

  it('survives malformed persisted state', () => {
    // vendorScreenData is read off disk and a hand-edited project can put
    // anything in it; a crash here would take the whole board list down.
    const before = { Board: { modbus_rtu: 'not an object' }, Other: null as unknown as Record<string, unknown> }
    expect(migrateModbusSerialFields(before, split)).toBe(before)
  })

  it('carries a false RS485 toggle across rather than dropping it', () => {
    // `false` is a value the user chose, not an absence.
    const after = migrateModbusSerialFields({ Board: { modbus_rtu: { enable_rs485_en_pin: false } } }, split)
    expect(after?.Board.serial).toEqual({ enable_rs485_en_pin: false })
  })
})
