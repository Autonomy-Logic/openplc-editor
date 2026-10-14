/**
 * Diagnostics decoder tests.  Covers bit 6 / bit 7 of the coupler status word and the
 * per-module status byte translation into human-readable messages.
 */

import { decodeCouplerStatus, decodeModuleStatus } from '../diagnostics-decode'

describe('decodeCouplerStatus', () => {
  test('bit 6 is the I/O configuration error', () => {
    expect(decodeCouplerStatus(0b0100_0000).ioConfigurationError).toBe(true)
    expect(decodeCouplerStatus(0b0000_0000).ioConfigurationError).toBe(false)
  })

  test('bit 7 is the master configuration error', () => {
    expect(decodeCouplerStatus(0b1000_0000).masterConfigurationError).toBe(true)
    expect(decodeCouplerStatus(0b0000_0000).masterConfigurationError).toBe(false)
  })

  test('both bits set are reported together', () => {
    expect(decodeCouplerStatus(0b1100_0000)).toEqual({
      ioConfigurationError: true,
      masterConfigurationError: true,
    })
  })

  test('unrelated bits do not trigger either flag', () => {
    expect(decodeCouplerStatus(0b0011_1111)).toEqual({
      ioConfigurationError: false,
      masterConfigurationError: false,
    })
  })
})

describe('decodeModuleStatus', () => {
  test('0x00 is operational', () => {
    expect(decodeModuleStatus(0x00)).toEqual({ operational: true, message: 'Operational' })
  })

  test('0x81 is "wrong module plugged in"', () => {
    expect(decodeModuleStatus(0x81)).toEqual({ operational: false, message: 'Wrong module plugged in' })
  })

  test('0x82 is "no module in this slot"', () => {
    expect(decodeModuleStatus(0x82)).toEqual({ operational: false, message: 'No module in this slot' })
  })

  test('0x83 is slot configuration mismatch', () => {
    expect(decodeModuleStatus(0x83)).toEqual({ operational: false, message: 'Configuration mismatch for this slot' })
  })

  test('an unknown byte prints as hex vendor-specific', () => {
    expect(decodeModuleStatus(0xa5)).toEqual({ operational: false, message: 'Vendor-specific status 0xA5' })
  })
})
