/**
 * The serial line resolved once, for the screen and the compiler alike.
 *
 * What these pin is not arithmetic: it is that each value has exactly ONE
 * source. The screen and the `defines.h` emitter call these same functions, and
 * every defect this area has produced came from the two deriving a value
 * independently and drifting apart.
 */

import {
  DEFAULT_SERIAL_BAUD,
  DEFAULT_SERVER_SLAVE_ID,
  isDefaultPort,
  readSerialBaudState,
  resolveDefaultPortBaud,
  resolveRs485Pin,
  resolveRtuPort,
  resolveServerBaud,
  resolveServerSlaveId,
} from '../baud'

describe('resolveDefaultPortBaud', () => {
  it("carries the package's value for the board's default UART", () => {
    expect(resolveDefaultPortBaud({ serial: { baud_rate: '57600' } })).toBe('57600')
  })

  it('falls back when the project states nothing', () => {
    expect(resolveDefaultPortBaud({})).toBe(DEFAULT_SERIAL_BAUD)
    expect(resolveDefaultPortBaud({ serial: {} })).toBe(DEFAULT_SERIAL_BAUD)
  })

  it('falls through a value that is not a positive integer', () => {
    // This is the number the editor dials to reach the debugger, so a bad one
    // locks the board out with nothing on screen to say why. `??` alone would
    // return a persisted empty string.
    for (const bad of ['', 'fast', '0', '-9600', '96.00', ' ']) {
      expect(resolveDefaultPortBaud({ serial: { baud_rate: bad } })).toBe(DEFAULT_SERIAL_BAUD)
    }
  })

  it('normalises surrounding whitespace', () => {
    expect(resolveDefaultPortBaud({ serial: { baud_rate: ' 115200 ' } })).toBe('115200')
  })
})

describe('resolveServerBaud', () => {
  it("takes the package's value on the default port, whatever the server says", () => {
    // One UART has one speed, the editor is already on it, and bit timing is not
    // something the firmware can route around the way it routes two slave ids.
    const state = { serial: { baud_rate: '19200' } }
    expect(resolveServerBaud({ onDefaultPort: true, serverBaud: 9600, state })).toBe('19200')
  })

  it("takes the server's value on a UART of its own", () => {
    expect(resolveServerBaud({ onDefaultPort: false, serverBaud: 9600, state: {} })).toBe('9600')
  })

  it('refuses a server value that could not reach the firmware intact', () => {
    // `Serial1.begin(0)` opens a dead line the screen would confirm as configured;
    // a fraction does not compile at all.
    for (const bad of [0, -9600, 96.5, Number.NaN]) {
      expect(resolveServerBaud({ onDefaultPort: false, serverBaud: bad, state: {} })).toBe(DEFAULT_SERIAL_BAUD)
    }
  })

  it('falls back when a secondary-port server states no baud', () => {
    expect(resolveServerBaud({ onDefaultPort: false, serverBaud: undefined, state: {} })).toBe(DEFAULT_SERIAL_BAUD)
  })
})

describe('resolveRtuPort', () => {
  it("takes the server's port when it names one", () => {
    expect(resolveRtuPort('Serial2', 'Serial')).toBe('Serial2')
  })

  it("falls back to the board's default UART", () => {
    expect(resolveRtuPort(undefined, 'Serial')).toBe('Serial')
    expect(resolveRtuPort('', 'Serial')).toBe('Serial')
    expect(resolveRtuPort('  ', 'Serial')).toBe('Serial')
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

describe('resolveServerSlaveId', () => {
  it("takes the server's id, which is where the user sets it", () => {
    expect(resolveServerSlaveId(7)).toBe(7)
  })

  it('falls back to 1 when the project states none', () => {
    expect(resolveServerSlaveId(undefined)).toBe(DEFAULT_SERVER_SLAVE_ID)
    expect(resolveServerSlaveId(undefined)).toBe(1)
  })

  it('refuses a non-integer rather than passing it to the firmware', () => {
    expect(resolveServerSlaveId(7.5)).toBe(1)
  })
})

describe('resolveRs485Pin', () => {
  it('reports the pin only when the board declares the driver-enable is wired', () => {
    // Without it the transceiver never asserts DE and the board receives every
    // request and answers none -- silent, with no warning on any path.
    expect(resolveRs485Pin({ serial: { enable_rs485_en_pin: true, rs485_en_pin: '17' } })).toBe('17')
  })

  it('reports nothing when it is off, unset, or enabled with no pin', () => {
    expect(resolveRs485Pin({})).toBeNull()
    expect(resolveRs485Pin({ serial: { rs485_en_pin: '17' } })).toBeNull()
    expect(resolveRs485Pin({ serial: { enable_rs485_en_pin: false, rs485_en_pin: '17' } })).toBeNull()
    expect(resolveRs485Pin({ serial: { enable_rs485_en_pin: true, rs485_en_pin: '' } })).toBeNull()
  })
})

describe('readSerialBaudState', () => {
  it('narrows the Serial screen off raw persisted state', () => {
    const state = readSerialBaudState({
      serial: { baud_rate: '19200', enable_rs485_en_pin: true, rs485_en_pin: '17' },
    })
    expect(resolveDefaultPortBaud(state)).toBe('19200')
    expect(resolveRs485Pin(state)).toBe('17')
  })

  it('survives a project file whose values are the wrong type', () => {
    // A user's project file, not our data: a number where a string belongs would
    // otherwise put a bad baud rate on screen and into the build.
    const state = readSerialBaudState({ serial: { baud_rate: 19200, enable_rs485_en_pin: 'yes', rs485_en_pin: 17 } })
    expect(resolveDefaultPortBaud(state)).toBe(DEFAULT_SERIAL_BAUD)
    expect(resolveRs485Pin(state)).toBeNull()
  })

  it('survives a missing or malformed serial section', () => {
    for (const raw of [undefined, null, {}, { serial: null }, { serial: 'nope' }, { serial: [] }]) {
      expect(resolveDefaultPortBaud(readSerialBaudState(raw))).toBe(DEFAULT_SERIAL_BAUD)
    }
  })

  it('ignores a pre-4.3.0 project entirely', () => {
    // 4.3.0 does not carry configuration forward: a project from before it
    // creates its Modbus server again, and nothing here reads the old section.
    const legacy = readSerialBaudState({
      modbus_rtu: { rtu_baud_rate: '9600', rtu_interface: 'Serial2', rtu_rs485_en_pin: '17' },
    })
    expect(resolveDefaultPortBaud(legacy)).toBe(DEFAULT_SERIAL_BAUD)
    expect(resolveRs485Pin(legacy)).toBeNull()
  })
})
