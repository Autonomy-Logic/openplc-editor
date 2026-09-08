/**
 * The speed of a serial line, which the screen displays and the compiler emits.
 *
 * These two used to be derived in separate places, and the failure that produces
 * is specific: the port opens, so it is not "no response", and nothing decodes,
 * so it reads as "no firmware" — and the user is told to reflash a board that is
 * running perfectly well. One resolver is the fix; these tests are what keeps it
 * honest about the shapes real projects persist.
 */

import { DEFAULT_SERIAL_BAUD, readSerialBaudState, resolveDefaultPortBaud, resolveServerBaud } from '../baud'

describe('resolveDefaultPortBaud', () => {
  it('prefers an explicit `serial` section when a package declares one', () => {
    expect(resolveDefaultPortBaud({ serial: { baud_rate: '57600' }, modbus_rtu: { rtu_baud_rate: '9600' } })).toBe(
      '57600',
    )
  })

  it('falls back to the RTU section for a package published before `serial` existed', () => {
    // A new editor can meet an old package: the version floor only stops the
    // other direction.
    expect(resolveDefaultPortBaud({ modbus_rtu: { rtu_baud_rate: '9600' } })).toBe('9600')
    expect(resolveDefaultPortBaud({ modbus_rtu: { baud_rate: '19200' } })).toBe('19200')
  })

  it('falls back for a project that states nothing', () => {
    expect(resolveDefaultPortBaud({})).toBe(DEFAULT_SERIAL_BAUD)
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
