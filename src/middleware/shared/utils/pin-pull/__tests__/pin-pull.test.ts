import type { PinPullSpec } from '../../../ports/types'
import { resolveEffectivePinPull, resolvePinPullRule } from '..'

const spec: PinPullSpec = {
  options: ['none', 'up', 'down'],
  pins: {
    '34': { fixed: 'none' },
    D0: { options: ['none', 'down'] },
    D8: { options: ['down'] },
    D3: { options: ['none', 'up'], default: 'up' },
  },
}

describe('resolvePinPullRule', () => {
  it('uses the board-wide options for a pin without an override', () => {
    expect(resolvePinPullRule(spec, '4')).toEqual({ kind: 'select', options: ['none', 'up', 'down'], default: 'none' })
  })

  it('returns the fixed value for a pin marked fixed', () => {
    expect(resolvePinPullRule(spec, '34')).toEqual({ kind: 'fixed', value: 'none' })
  })

  it('treats a single-option override as fixed', () => {
    expect(resolvePinPullRule(spec, 'D8')).toEqual({ kind: 'fixed', value: 'down' })
  })

  it('narrows the options and honours the per-pin default', () => {
    expect(resolvePinPullRule(spec, 'D0')).toEqual({ kind: 'select', options: ['none', 'down'], default: 'none' })
    expect(resolvePinPullRule(spec, 'D3')).toEqual({ kind: 'select', options: ['none', 'up'], default: 'up' })
  })

  it('matches numeric pin names by value', () => {
    expect(resolvePinPullRule(spec, '034')).toEqual({ kind: 'fixed', value: 'none' })
    const padded: PinPullSpec = { options: ['none'], pins: { '05': { options: ['none', 'up'] } } }
    expect(resolvePinPullRule(padded, '5')).toEqual({ kind: 'select', options: ['none', 'up'], default: 'none' })
  })

  it('treats every unlisted pin as fixed when the board-wide options hold one mode', () => {
    const allowList: PinPullSpec = { options: ['none'], pins: { '4': { options: ['none', 'up', 'down'] } } }
    expect(resolvePinPullRule(allowList, '5')).toEqual({ kind: 'fixed', value: 'none' })
    expect(resolvePinPullRule(allowList, '4').kind).toBe('select')
  })

  it('falls back to the first option when the default is not offered', () => {
    const upOnly: PinPullSpec = { options: ['up', 'down'] }
    expect(resolvePinPullRule(upOnly, '1')).toEqual({ kind: 'select', options: ['up', 'down'], default: 'up' })
  })
})

describe('resolveEffectivePinPull', () => {
  it('keeps a stored value the rule allows', () => {
    expect(resolveEffectivePinPull(spec, { pin: '4', pull: 'down' })).toBe('down')
  })

  it('replaces a stored value the rule does not allow with the default', () => {
    expect(resolveEffectivePinPull(spec, { pin: 'D0', pull: 'up' })).toBe('none')
  })

  it('ignores the stored value on a fixed pin', () => {
    expect(resolveEffectivePinPull(spec, { pin: '34', pull: 'up' })).toBe('none')
  })

  it('uses the default when nothing is stored', () => {
    expect(resolveEffectivePinPull(spec, { pin: 'D3' })).toBe('up')
  })
})
