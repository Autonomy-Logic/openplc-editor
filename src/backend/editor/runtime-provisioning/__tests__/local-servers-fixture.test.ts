/** @jest-environment node */

import { utils } from 'ssh2'

import { ed25519HostKey } from './fixtures/local-servers'

describe('the SSH fixture host keys', () => {
  it('gives ed25519 host keys that ssh2 can always parse back', () => {
    const keys = Array.from({ length: 1_000 }, () => ed25519HostKey())

    const unparsable = keys
      .filter((key) => utils.parseKey(key.privateKey) instanceof Error)
      .map((key) => key.publicBlob)

    expect(unparsable).toEqual([])
  })

  it('gives a different ed25519 host key on each call', () => {
    const first = ed25519HostKey()
    const second = ed25519HostKey()

    expect(second.privateKey).not.toBe(first.privateKey)
    expect(second.publicBlob).not.toBe(first.publicBlob)
  })
})
