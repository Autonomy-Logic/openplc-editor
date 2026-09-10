import { asCoilVariant, asContactVariant } from '../symbols'

describe('asCoilVariant', () => {
  it('passes through every recognized variant', () => {
    expect(asCoilVariant('negated')).toBe('negated')
    expect(asCoilVariant('risingEdge')).toBe('risingEdge')
    expect(asCoilVariant('fallingEdge')).toBe('fallingEdge')
    expect(asCoilVariant('set')).toBe('set')
    expect(asCoilVariant('reset')).toBe('reset')
  })

  it('falls back to default for unrecognized or missing values', () => {
    expect(asCoilVariant('bogus')).toBe('default')
    expect(asCoilVariant(undefined)).toBe('default')
  })
})

describe('asContactVariant', () => {
  it('passes through every recognized variant', () => {
    expect(asContactVariant('negated')).toBe('negated')
    expect(asContactVariant('risingEdge')).toBe('risingEdge')
    expect(asContactVariant('fallingEdge')).toBe('fallingEdge')
  })

  it('falls back to default for unrecognized or missing values', () => {
    expect(asContactVariant('bogus')).toBe('default')
    expect(asContactVariant(undefined)).toBe('default')
  })
})
