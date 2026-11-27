import { resolveReconnect } from '..'

describe('resolveReconnect', () => {
  it('reconnects a TCP device saved with Reconnect checked', () => {
    expect(resolveReconnect({ transport: 'tcp', reconnect: true })).toBe(true)
  })

  it('gives up on a TCP device saved with Reconnect unchecked', () => {
    expect(resolveReconnect({ transport: 'tcp', reconnect: false })).toBe(false)
  })

  it('reconnects a TCP device saved before the option existed', () => {
    expect(resolveReconnect({ transport: 'tcp' })).toBe(true)
  })

  it('treats a device with no transport as TCP', () => {
    expect(resolveReconnect({})).toBe(true)
    expect(resolveReconnect({ reconnect: false })).toBe(false)
  })

  it('never applies to an RTU device', () => {
    expect(resolveReconnect({ transport: 'rtu' })).toBe(false)
    expect(resolveReconnect({ transport: 'rtu', reconnect: true })).toBe(false)
  })
})
