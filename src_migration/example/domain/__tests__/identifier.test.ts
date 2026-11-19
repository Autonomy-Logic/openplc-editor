// Domain tests: pure functions, no React, no state, no fakes needed.
import { checkIdentifier, sameIdentifier } from '..'

describe('checkIdentifier', () => {
  it.each(['Motor', 'motor_1', '_hidden', 'A', 'x1_y2', '_9'])('accepts %s', (name) => {
    expect(checkIdentifier(name)).toBeNull()
  })

  it('rejects an empty name', () => {
    expect(checkIdentifier('')).toBe('empty')
  })

  it.each(['1motor', 'motor__speed', 'motor_', '_', 'motor speed', 'motor-1', 'ação'])('rejects %s', (name) => {
    expect(checkIdentifier(name)).toBe('invalid-format')
  })
})

describe('sameIdentifier', () => {
  it('compares names case-insensitively', () => {
    expect(sameIdentifier('MotorSpeed', 'MOTORSPEED')).toBe(true)
    expect(sameIdentifier('MotorSpeed', 'MotorSpeed1')).toBe(false)
  })
})
