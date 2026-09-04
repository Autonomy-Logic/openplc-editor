/**
 * The bootloader client's address guard.
 *
 * The address reaches this client from the renderer and is handed to
 * https.request. A compromised renderer could otherwise shape it into a
 * request at a target of its choosing (CWE-918), so anything that is not a
 * bare hostname or IP literal is refused before a socket is opened.
 *
 * Note what this does NOT claim: it narrows the value, it does not authorize
 * the destination. Restricting calls to the device the operator selected needs
 * main-process device state that does not exist yet.
 */

import { BootloaderApiClient } from '../bootloader-api-client'

describe('BootloaderApiClient address handling', () => {
  const client = new BootloaderApiClient()

  const refused = [
    ['a scheme', 'https://evil.example.com'],
    ['an embedded port', '10.0.0.5:9999'],
    ['credentials', 'user:pass@10.0.0.5'],
    ['a path', '10.0.0.5/../../admin'],
    ['a query', '10.0.0.5?x=1'],
    ['whitespace', '10.0.0.5 evil.example.com'],
    ['a newline', '10.0.0.5\nHost: evil'],
    ['empty', ''],
  ] as const

  it.each(refused)('refuses %s without opening a connection', async (_label, address) => {
    // getCapabilities is the unauthenticated entry point, so this covers the
    // path that does not need a stored token first.
    const result = await client.getCapabilities(address)

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/not a device address/i)
  })

  // RFC 5737 / RFC 3849 documentation ranges and a reserved name, so nothing
  // here can resolve to a real host. An earlier version used the test
  // device's own address and passed or failed depending on whether that
  // device happened to be on the network.
  const accepted = [
    ['an IPv4 literal', '192.0.2.10'],
    ['a hostname', 'device-under-test'],
    ['a dotted hostname', 'device-under-test.invalid'],
    ['a bracketed IPv6 literal', '[2001:db8::1]'],
  ] as const

  it.each(accepted)('accepts %s and gets as far as the connection', async (_label, address) => {
    // Whether the connection then succeeds is not this test's business -- only
    // that the address itself was not what stopped it.
    const result = await client.getCapabilities(address)

    if (!result.success) {
      expect(result.error).not.toMatch(/not a device address/i)
    }
  })
})
