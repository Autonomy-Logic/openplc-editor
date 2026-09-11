/**
 * The speed of a serial line, which the screen displays and the compiler emits.
 *
 * These two used to be derived in separate places, and the failure that produces
 * is specific: the port opens, so it is not "no response", and nothing decodes,
 * so it reads as "no firmware" — and the user is told to reflash a board that is
 * running perfectly well. One resolver is the fix; these tests are what keeps it
 * honest about the shapes real projects persist.
 */

import {
  DEFAULT_SERIAL_BAUD,
  isDefaultPort,
  readSerialBaudState,
  resolveDefaultPortBaud,
  resolveRs485Pin,
  resolveRtuPort,
  resolveServerBaud,
} from '../baud'

describe('resolveDefaultPortBaud', () => {
  it('prefers an explicit `serial` section when a package declares one', () => {
    expect(resolveDefaultPortBaud({ serial: { baud_rate: '57600' }, modbus_rtu: { rtu_baud_rate: '9600' } })).toBe(
      '57600',
    )
  })

  it('falls back to the RTU section when the RTU is on this very port', () => {
    // A new editor can meet an old package: the version floor only stops the
    // other direction. Pre-split, the RTU and the debugger shared the default
    // UART, so the RTU's baud IS this port's.
    expect(resolveDefaultPortBaud({ modbus_rtu: { rtu_baud_rate: '9600' } }, true)).toBe('9600')
    expect(resolveDefaultPortBaud({ modbus_rtu: { baud_rate: '19200' } }, true)).toBe('19200')
    // And where the fold lands that same value.
    expect(resolveDefaultPortBaud({ serial: { modbus_baud_rate: '19200' } }, true)).toBe('19200')
  })

  it('ignores the RTU baud when the RTU is on a SECOND port', () => {
    // That number describes the other UART. Applying it here brings the USB
    // port up at a speed nothing answers on, and the editor reports "No
    // Firmware Detected" on a healthy board.
    expect(resolveDefaultPortBaud({ modbus_rtu: { rtu_baud_rate: '9600' } })).toBe(DEFAULT_SERIAL_BAUD)
    expect(resolveDefaultPortBaud({ serial: { modbus_baud_rate: '9600' } })).toBe(DEFAULT_SERIAL_BAUD)
    // The port's own declared speed still wins, whatever the RTU is doing.
    expect(resolveDefaultPortBaud({ serial: { baud_rate: '57600' }, modbus_rtu: { rtu_baud_rate: '9600' } })).toBe(
      '57600',
    )
  })

  it('falls back for a project that states nothing', () => {
    expect(resolveDefaultPortBaud({})).toBe(DEFAULT_SERIAL_BAUD)
  })

  it('falls through a value that is not a positive integer', () => {
    // This is the number the editor dials to reach the debugger, so a bad one
    // locks the board out with nothing on screen to say why.
    expect(resolveDefaultPortBaud({ serial: { baud_rate: '' } })).toBe(DEFAULT_SERIAL_BAUD)
    expect(resolveDefaultPortBaud({ serial: { baud_rate: 'fast' } })).toBe(DEFAULT_SERIAL_BAUD)
    expect(resolveDefaultPortBaud({ serial: { baud_rate: '0' } })).toBe(DEFAULT_SERIAL_BAUD)
    expect(resolveDefaultPortBaud({ serial: { baud_rate: '-9600' } })).toBe(DEFAULT_SERIAL_BAUD)
    expect(resolveDefaultPortBaud({ serial: { baud_rate: '96.00' } })).toBe(DEFAULT_SERIAL_BAUD)
  })

  it('takes the next candidate when the first is unusable', () => {
    expect(resolveDefaultPortBaud({ serial: { baud_rate: '' }, modbus_rtu: { rtu_baud_rate: '9600' } }, true)).toBe(
      '9600',
    )
  })

  it('normalises surrounding whitespace', () => {
    expect(resolveDefaultPortBaud({ serial: { baud_rate: ' 115200 ' } })).toBe('115200')
  })
})

describe('resolveServerBaud', () => {
  const state = { serial: { baud_rate: '19200', modbus_baud_rate: '38400' } }

  it("takes the default port's speed when the server is on that port", () => {
    // One UART has one speed, and the editor is already on it. Unlike the slave
    // id, no firmware routing makes two values possible here.
    expect(resolveServerBaud({ onDefaultPort: true, serverBaud: 9600, state })).toBe('19200')
  })

  it("takes the server's own speed on a UART of its own", () => {
    expect(resolveServerBaud({ onDefaultPort: false, serverBaud: 9600, state })).toBe('9600')
  })

  it('falls back to where the value used to live, so an existing project keeps building the same firmware', () => {
    // A project that already carries a server but no `baudRate`: the value is
    // still sitting in the screen state the package no longer renders.
    expect(resolveServerBaud({ onDefaultPort: false, serverBaud: undefined, state })).toBe('38400')
  })

  it('falls back to the default when neither the server nor the project states one', () => {
    expect(resolveServerBaud({ onDefaultPort: false, serverBaud: undefined, state: {} })).toBe(DEFAULT_SERIAL_BAUD)
  })

  it('ignores a stored value that is not a finite number', () => {
    expect(resolveServerBaud({ onDefaultPort: false, serverBaud: Number.NaN, state })).toBe('38400')
  })
})

describe('readSerialBaudState', () => {
  it('reads the two sections it cares about', () => {
    const read = readSerialBaudState({
      serial: { baud_rate: '9600', modbus_baud_rate: '19200' },
      modbus_rtu: { rtu_baud_rate: '38400' },
      network: { enabled: true },
    })

    expect(read.serial?.baud_rate).toBe('9600')
    expect(read.serial?.modbus_baud_rate).toBe('19200')
    expect(read.modbus_rtu?.rtu_baud_rate).toBe('38400')
  })

  it('survives a project file that holds anything at all under those keys', () => {
    // This is a user's project, and a wrong type here would put a bad rate on
    // screen and into the build rather than fail loudly.
    expect(readSerialBaudState({ serial: 'nine thousand six hundred', modbus_rtu: null })).toEqual({
      serial: { baud_rate: undefined, modbus_baud_rate: undefined },
      modbus_rtu: { baud_rate: undefined, rtu_baud_rate: undefined },
    })
    expect(readSerialBaudState({ serial: { baud_rate: 9600 } }).serial?.baud_rate).toBeUndefined()
    expect(readSerialBaudState({ serial: { baud_rate: '' } }).serial?.baud_rate).toBeUndefined()
  })

  it('handles no screen state at all', () => {
    expect(resolveDefaultPortBaud(readSerialBaudState(undefined))).toBe(DEFAULT_SERIAL_BAUD)
    expect(resolveDefaultPortBaud(readSerialBaudState(null))).toBe(DEFAULT_SERIAL_BAUD)
  })
})

/**
 * The RTU's UART and its RS-485 pin moved from `modbus_rtu` into `serial`, and
 * `migrate-modbus-serial-fields` folds the old spellings forward -- but it runs
 * in the STORE while the compiler reads the project from disk, and on a board
 * whose package was never split it never runs at all. Reading only the new keys
 * loses the wiring on exactly the projects that still carry the old ones.
 */
describe('the legacy wiring keys', () => {
  it('resolves the RTU port through all three spellings, newest first', () => {
    expect(resolveRtuPort({ serial: { modbus_port: 'Serial1' } }, undefined, 'Serial')).toBe('Serial1')
    expect(resolveRtuPort({ modbus_rtu: { serial_port: 'Serial2' } }, undefined, 'Serial')).toBe('Serial2')
    expect(resolveRtuPort({ modbus_rtu: { rtu_interface: 'Serial3' } }, undefined, 'Serial')).toBe('Serial3')
  })

  it('lets the server override every screen key, and falls back to the board default', () => {
    expect(resolveRtuPort({ serial: { modbus_port: 'Serial1' } }, 'Serial2', 'Serial')).toBe('Serial2')
    expect(resolveRtuPort({}, undefined, 'Serial')).toBe('Serial')
  })

  it('reads the RS-485 driver-enable pin from the legacy section too', () => {
    // Without this the transceiver never asserts DE and the board receives but
    // never answers -- silent, with no warning on any path.
    expect(resolveRs485Pin({ serial: { enable_rs485_en_pin: true, rs485_en_pin: '4' } })).toBe('4')
    expect(resolveRs485Pin({ modbus_rtu: { enable_rs485_en_pin: true, rtu_rs485_en_pin: '17' } })).toBe('17')
  })

  it('reports no pin when the project never enabled one, or enabled one with no pin', () => {
    expect(resolveRs485Pin({})).toBeNull()
    expect(resolveRs485Pin({ modbus_rtu: { rtu_rs485_en_pin: '17' } })).toBeNull()
    expect(resolveRs485Pin({ serial: { enable_rs485_en_pin: true, rs485_en_pin: '' } })).toBeNull()
  })

  it('narrows the legacy keys off raw persisted state', () => {
    const state = readSerialBaudState({
      modbus_rtu: {
        rtu_interface: 'Serial2',
        rtu_baud_rate: '19200',
        enable_rs485_en_pin: true,
        rtu_rs485_en_pin: '17',
      },
    })
    expect(resolveRtuPort(state, undefined, 'Serial')).toBe('Serial2')
    expect(resolveRs485Pin(state)).toBe('17')
    expect(resolveDefaultPortBaud(state, true)).toBe('19200')
  })
})

describe('isDefaultPort', () => {
  it('treats an unset port as the board default, because that is what empty means', () => {
    expect(isDefaultPort(undefined, 'Serial')).toBe(true)
    expect(isDefaultPort('', 'Serial')).toBe(true)
    expect(isDefaultPort('Serial', 'Serial')).toBe(true)
    expect(isDefaultPort('Serial1', 'Serial')).toBe(false)
  })
})
