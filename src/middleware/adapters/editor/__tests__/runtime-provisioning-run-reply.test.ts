import { toRuntimeProvisioningEvent } from '../../../shared/ports/runtime-provisioning-port'
import { toRunEndToken, toRunReply } from '../runtime-provisioning-run-reply'

const BAD_TOKENS: [string, unknown][] = [
  ['zero', 0],
  ['a negative number', -1],
  ['a fraction', 1.5],
  ['a string', '7'],
  ['a number past the safe integers', Number.MAX_SAFE_INTEGER + 1],
]

describe('toRunReply', () => {
  it('accepts an envelope with an outcome and a positive integer end token', () => {
    expect(toRunReply({ outcome: { kind: 'installer-failed', lastLines: ['a'] }, endToken: 7 })).toEqual({
      outcome: { kind: 'installer-failed', lastLines: ['a'] },
      endToken: 7,
    })
  })

  it('accepts the largest safe integer as an end token', () => {
    expect(toRunReply({ outcome: { kind: 'busy' }, endToken: Number.MAX_SAFE_INTEGER })).toEqual({
      outcome: { kind: 'busy' },
      endToken: Number.MAX_SAFE_INTEGER,
    })
  })

  it('reads an envelope whose outcome is not a known outcome as the outcome unknown', () => {
    expect(toRunReply({ outcome: { kind: 'exploded' }, endToken: 7 })).toEqual({
      outcome: { kind: 'unknown' },
      endToken: 7,
    })
  })

  it('reads an envelope with no outcome as the outcome unknown', () => {
    expect(toRunReply({ endToken: 7 })).toEqual({ outcome: { kind: 'unknown' }, endToken: 7 })
  })

  it.each(BAD_TOKENS)('refuses an envelope whose end token is %s', (_, endToken) => {
    expect(toRunReply({ outcome: { kind: 'cancelled' }, endToken })).toBeNull()
  })

  it.each([
    ['a bare outcome', { kind: 'connected-ready', operation: 'install' }],
    ['an envelope with no end token', { outcome: { kind: 'cancelled' } }],
    ['an array', [{ outcome: { kind: 'cancelled' }, endToken: 7 }]],
    ['null', null],
    ['undefined', undefined],
    ['a number', 7],
    ['a string', 'connected-ready'],
  ])('refuses %s', (_, value) => {
    expect(toRunReply(value)).toBeNull()
  })
})

describe('toRunEndToken', () => {
  it('reads the token of a run-end marker', () => {
    expect(toRunEndToken({ type: 'run-end', token: 7 })).toBe(7)
  })

  it('reads the largest safe integer as a token', () => {
    expect(toRunEndToken({ type: 'run-end', token: Number.MAX_SAFE_INTEGER })).toBe(Number.MAX_SAFE_INTEGER)
  })

  it.each(BAD_TOKENS)('refuses a run-end marker whose token is %s', (_, token) => {
    expect(toRunEndToken({ type: 'run-end', token })).toBeNull()
  })

  it.each([
    ['a marker with another type', { type: 'run-ended', token: 7 }],
    ['a marker with no type', { token: 7 }],
    ['a marker with no token', { type: 'run-end' }],
    ['an output event', { type: 'output', line: 'Done' }],
    ['an audit event', { type: 'audit', line: '[runtime-provisioning-audit] target=192.168.1.50:22' }],
    ['an array', [{ type: 'run-end', token: 7 }]],
    ['null', null],
    ['a string', 'run-end'],
    ['undefined', undefined],
  ])('refuses %s', (_, value) => {
    expect(toRunEndToken(value)).toBeNull()
  })
})

describe('the run-end marker on the event channel', () => {
  it('is never read as a port event', () => {
    expect(toRuntimeProvisioningEvent({ type: 'run-end', token: 7 })).toBeNull()
  })
})
