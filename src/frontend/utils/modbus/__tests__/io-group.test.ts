import type { ModbusIOPoint } from '../../../../middleware/shared/ports/types'
import {
  clampIOGroupLength,
  formatIOGroupAddressRange,
  isSingleElementFunctionCode,
  MAX_IO_GROUP_LENGTH_BY_FC,
  validateIOGroupLength,
} from '../io-group'

const point = (iecLocation: string): ModbusIOPoint => ({
  id: iecLocation,
  name: iecLocation,
  type: 'Analog Input (Input Registers)',
  iecLocation,
})

describe('isSingleElementFunctionCode', () => {
  it('is true only for FC 5 and FC 6', () => {
    expect(isSingleElementFunctionCode('5')).toBe(true)
    expect(isSingleElementFunctionCode('6')).toBe(true)
    for (const fc of ['1', '2', '3', '4', '15', '16'] as const) {
      expect(isSingleElementFunctionCode(fc)).toBe(false)
    }
  })
})

describe('clampIOGroupLength', () => {
  it('raises non-positive lengths to a single point', () => {
    expect(clampIOGroupLength('3', -5)).toBe(1)
    expect(clampIOGroupLength('3', 0)).toBe(1)
  })

  it('floors fractional lengths', () => {
    expect(clampIOGroupLength('3', 3.7)).toBe(3)
  })

  it('falls back to a single point for non-finite lengths', () => {
    expect(clampIOGroupLength('3', NaN)).toBe(1)
    expect(clampIOGroupLength('3', Infinity)).toBe(1)
  })

  it('forces a single point for single-element function codes', () => {
    expect(clampIOGroupLength('5', 10)).toBe(1)
    expect(clampIOGroupLength('6', 4)).toBe(1)
  })

  it('leaves an over-maximum length untouched', () => {
    // Deliberate: applying the PDU maximum here would silently truncate a
    // pre-existing group the moment the user edited only its name.
    expect(clampIOGroupLength('3', 200)).toBe(200)
  })

  it('passes valid lengths through', () => {
    expect(clampIOGroupLength('3', 4)).toBe(4)
  })
})

describe('validateIOGroupLength', () => {
  it('always accepts single-element function codes as length 1', () => {
    expect(validateIOGroupLength('5', '10')).toEqual({ ok: true, length: 1 })
    expect(validateIOGroupLength('6', '')).toEqual({ ok: true, length: 1 })
  })

  it('rejects an empty field', () => {
    expect(validateIOGroupLength('3', '  ')).toEqual({ ok: false, message: 'Length is required.' })
  })

  it('rejects a non-numeric value', () => {
    expect(validateIOGroupLength('3', 'abc')).toEqual({ ok: false, message: 'Length must be a number.' })
  })

  it('rejects a fractional value', () => {
    expect(validateIOGroupLength('3', '3.5')).toEqual({ ok: false, message: 'Length must be a whole number.' })
  })

  it('rejects values below 1', () => {
    expect(validateIOGroupLength('3', '0')).toEqual({ ok: false, message: 'Length must be at least 1.' })
    expect(validateIOGroupLength('3', '-5')).toEqual({ ok: false, message: 'Length must be at least 1.' })
  })

  it('rejects values above the function code PDU limit, naming the code', () => {
    expect(validateIOGroupLength('3', '126')).toEqual({
      ok: false,
      message: 'FC 3 addresses at most 125 elements per request.',
    })
    expect(validateIOGroupLength('16', '124')).toEqual({
      ok: false,
      message: 'FC 16 addresses at most 123 elements per request.',
    })
  })

  it('accepts values at the limit', () => {
    expect(validateIOGroupLength('3', '125')).toEqual({ ok: true, length: 125 })
    expect(validateIOGroupLength('1', '2000')).toEqual({ ok: true, length: 2000 })
    expect(validateIOGroupLength('15', ' 1968 ')).toEqual({ ok: true, length: 1968 })
  })

  it('exposes a maximum for every function code', () => {
    expect(Object.keys(MAX_IO_GROUP_LENGTH_BY_FC).sort()).toEqual(['1', '15', '16', '2', '3', '4', '5', '6'])
  })
})

describe('formatIOGroupAddressRange', () => {
  it('renders a dash when the group has no points', () => {
    expect(formatIOGroupAddressRange([])).toBe('-')
  })

  it('renders the single address when the group has one point', () => {
    expect(formatIOGroupAddressRange([point('%IW0')])).toBe('%IW0')
  })

  it('renders first through last when the group has several points', () => {
    expect(formatIOGroupAddressRange([point('%IW0'), point('%IW1'), point('%IW2'), point('%IW3')])).toBe('%IW0 – %IW3')
  })
})
