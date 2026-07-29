import { findModbusScreenName } from '../modbus-screen'

describe('findModbusScreenName', () => {
  it('returns undefined when screens is undefined', () => {
    expect(findModbusScreenName(undefined)).toBeUndefined()
  })

  it('returns undefined for an empty screens record', () => {
    expect(findModbusScreenName({})).toBeUndefined()
  })

  it('finds the canonical "Modbus" screen key', () => {
    expect(findModbusScreenName({ Modbus: 'screens/modbus.json' })).toBe('Modbus')
  })

  it('matches case-insensitively', () => {
    expect(findModbusScreenName({ modbus: {} })).toBe('modbus')
    expect(findModbusScreenName({ MODBUS: {} })).toBe('MODBUS')
  })

  it('ignores non-Modbus screens', () => {
    expect(findModbusScreenName({ Ethernet: {}, IO: {} })).toBeUndefined()
  })

  it('returns the Modbus key when mixed with other screens', () => {
    expect(findModbusScreenName({ IO: {}, Modbus: {}, Network: {} })).toBe('Modbus')
  })
})
