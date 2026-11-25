import type { RuntimeConnectFailureKind } from '../../../ports/runtime-port'
import { classifyRuntimeConnectError, startsProvisioningChecks } from '../connect-failure'

describe('classifyRuntimeConnectError', () => {
  it.each<[string, RuntimeConnectFailureKind]>([
    ['ECONNREFUSED', 'refused'],
    ['ETIMEDOUT', 'timeout'],
    ['EHOSTUNREACH', 'host-unreachable'],
    ['ENETUNREACH', 'network-unreachable'],
  ])('classifies %s as %s', (code, kind) => {
    expect(classifyRuntimeConnectError({ code, timedOut: false })).toBe(kind)
  })

  it.each([
    'ECONNRESET',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EPROTO',
    'ERR_SSL_WRONG_VERSION_NUMBER',
    'CERT_HAS_EXPIRED',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'EPIPE',
    'econnrefused',
    '',
  ])('classifies %p as other', (code) => {
    expect(classifyRuntimeConnectError({ code, timedOut: false })).toBe('other')
  })

  it('classifies an error with no code as other', () => {
    expect(classifyRuntimeConnectError({ timedOut: false })).toBe('other')
  })

  it.each([undefined, 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH'])(
    'classifies a timed-out request as timeout whatever the code (%p)',
    (code) => {
      expect(classifyRuntimeConnectError({ code, timedOut: true })).toBe('timeout')
    },
  )
})

describe('startsProvisioningChecks', () => {
  it.each<RuntimeConnectFailureKind>(['refused', 'timeout', 'host-unreachable', 'network-unreachable'])(
    'starts the bootloader and SSH checks after %s',
    (kind) => {
      expect(startsProvisioningChecks(kind)).toBe(true)
    },
  )

  it('keeps the existing error for any other failure', () => {
    expect(startsProvisioningChecks('other')).toBe(false)
  })

  it('starts nothing when there was no transport failure', () => {
    expect(startsProvisioningChecks(undefined)).toBe(false)
  })

  it.each<[string | undefined, boolean, boolean]>([
    ['ECONNREFUSED', false, true],
    [undefined, true, true],
    ['EHOSTUNREACH', false, true],
    ['ENETUNREACH', false, true],
    ['ECONNRESET', false, false],
    ['EPROTO', false, false],
    ['ERR_SSL_WRONG_VERSION_NUMBER', false, false],
    ['ENOTFOUND', false, false],
  ])('a connect error with code %p and timedOut %p starts the checks: %p', (code, timedOut, expected) => {
    expect(startsProvisioningChecks(classifyRuntimeConnectError({ code, timedOut }))).toBe(expected)
  })
})
