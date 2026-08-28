import { describe, expect, it } from '@jest/globals'

import { memberChainBefore } from '../member-chain'

describe('memberChainBefore', () => {
  it('returns the whole chain, not just the trailing word', () => {
    // The bug this exists for: Monaco reports `rat` and loses `m.Gear`.
    expect(memberChainBefore('  m.Gear.rat')).toBe('m.Gear.rat')
  })

  it('keeps a chain that ends on the dot', () => {
    expect(memberChainBefore('  motor.')).toBe('motor.')
  })

  it('returns a bare identifier unchanged', () => {
    expect(memberChainBefore('  mot')).toBe('mot')
  })

  it('carries an array subscript through to the LSP', () => {
    expect(memberChainBefore('  bank[1].sp')).toBe('bank[1].sp')
    expect(memberChainBefore('  grid[1][2].')).toBe('grid[1][2].')
  })

  it('anchors on the argument, not the call, inside a parenthesis', () => {
    expect(memberChainBefore('  foo(bar.')).toBe('bar.')
  })

  it.each([
    ['  a + b.', 'b.'],
    ['  x = motor.sp', 'motor.sp'],
    ['  if (ctl.', 'ctl.'],
    ['  vals, other.', 'other.'],
    ['  *ptr.', 'ptr.'],
  ])('stops at the operator in %j', (line, expected) => {
    expect(memberChainBefore(line)).toBe(expected)
  })

  it('returns empty when the cursor is not at the end of a chain', () => {
    expect(memberChainBefore('')).toBe('')
    expect(memberChainBefore('   ')).toBe('')
    expect(memberChainBefore('  x = ')).toBe('')
    expect(memberChainBefore('  foo(')).toBe('')
  })

  it('does not read a numeric literal as a chain', () => {
    // Without the leading-letter guard `1.5` scans as a chain rooted at `1`,
    // and every decimal typed in a C++ block would open a member list.
    expect(memberChainBefore('  x = 1.5')).toBe('')
    expect(memberChainBefore('  x = 0.')).toBe('')
  })

  it('allows an underscore-led identifier', () => {
    expect(memberChainBefore('  _private.field')).toBe('_private.field')
  })
})
