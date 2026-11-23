import type { HostKeyEntry, HostKeyFileState } from '../host-key-file'
import { decideHostKey, keyTypeFromBlob, parseHostKeyFile, serializeHostKeyFile } from '../host-key-file'

const NOW = '2026-11-05T12:00:00.000Z'
const EARLIER = '2026-10-01T08:30:00.000Z'

interface TestKey {
  keyType: string
  key: string
}

function sshString(bytes: number[]): number[] {
  const length = bytes.length
  return [(length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff, ...bytes]
}

function asciiBytes(text: string): number[] {
  return Array.from(text, (character) => character.charCodeAt(0))
}

function toBase64(bytes: number[]): string {
  return btoa(String.fromCharCode(...bytes))
}

function testKey(keyType: string, fill: number): TestKey {
  const keyBytes = Array.from({ length: 32 }, () => fill)
  return { keyType, key: toBase64([...sshString(asciiBytes(keyType)), ...sshString(keyBytes)]) }
}

const ED25519_AAAA = testKey('ssh-ed25519', 0xaa)
const ED25519_BBBB = testKey('ssh-ed25519', 0xbb)
const ED25519_CCCC = testKey('ssh-ed25519', 0xcc)
const ECDSA = testKey('ecdsa-sha2-nistp256', 0xaa)
const MALFORMED_KEY = toBase64([0, 0, 0, 50, 0x73, 0x73, 0x68])

function entry(host: string, port: number, presented: TestKey, firstSeen: string = EARLIER): HostKeyEntry {
  return { host, port, keyType: presented.keyType, key: presented.key, firstSeen }
}

function fileText(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function validState(entries: HostKeyEntry[]): HostKeyFileState {
  return { kind: 'valid', entries }
}

function entriesOf(text: string): HostKeyEntry[] {
  const state = parseHostKeyFile({ kind: 'text', text })
  return state.kind === 'valid' ? state.entries : []
}

describe('keyTypeFromBlob', () => {
  it.each([ED25519_AAAA, ECDSA, testKey('ssh-rsa', 0x01)])('reads $keyType from the first SSH string', (presented) => {
    expect(keyTypeFromBlob(presented.key)).toBe(presented.keyType)
  })

  it.each([
    ['an empty blob', ''],
    ['text that is not base64', 'not base64 at all!'],
    ['a blob shorter than the 4-byte length', toBase64([0, 0])],
    ['a length longer than the remaining bytes', MALFORMED_KEY],
    ['a key type that is not ASCII', toBase64([0, 0, 0, 2, 0xc3, 0xa9])],
  ])('returns null for %s', (_, blob) => {
    expect(keyTypeFromBlob(blob)).toBeNull()
  })
})

describe('parseHostKeyFile', () => {
  const remembered = entry('192.168.1.50', 22, ED25519_AAAA)
  const { firstSeen: _firstSeen, ...withoutFirstSeen } = remembered

  it('reports an absent file as absent', () => {
    expect(parseHostKeyFile({ kind: 'absent' })).toEqual({ kind: 'absent' })
  })

  it('reports a file that cannot be read as unusable, never as empty data', () => {
    expect(parseHostKeyFile({ kind: 'error', message: 'EACCES: permission denied' })).toEqual({
      kind: 'unusable',
      reason: 'unreadable',
    })
  })

  it.each([
    ['a 0-byte file', ''],
    ['a whitespace-only file', '  \n\t \r\n'],
  ])('reports %s as unusable and empty', (_, text) => {
    expect(parseHostKeyFile({ kind: 'text', text })).toEqual({ kind: 'unusable', reason: 'empty' })
  })

  it('reads every remembered entry of a valid file, in file order', () => {
    const other = entry('192.168.1.50', 2222, ED25519_CCCC)
    const text = fileText({ version: 1, hosts: [remembered, other] })

    expect(parseHostKeyFile({ kind: 'text', text })).toEqual({ kind: 'valid', entries: [remembered, other] })
  })

  it('reads a valid file with no remembered host', () => {
    expect(parseHostKeyFile({ kind: 'text', text: fileText({ version: 1, hosts: [] }) })).toEqual({
      kind: 'valid',
      entries: [],
    })
  })

  it.each([
    ['text that is not JSON', 'not json'],
    ['a JSON array', fileText([remembered])],
    ['an unknown version', fileText({ version: 2, hosts: [remembered] })],
    ['a missing version', fileText({ hosts: [remembered] })],
    ['a missing hosts list', fileText({ version: 1 })],
    ['hosts that is not a list', fileText({ version: 1, hosts: {} })],
    ['an extra top-level field', fileText({ version: 1, hosts: [remembered], comment: 'x' })],
    ['an entry missing a field', fileText({ version: 1, hosts: [withoutFirstSeen] })],
    ['an entry with an extra field', fileText({ version: 1, hosts: [{ ...remembered, user: 'pi' }] })],
    ['a port written as text', fileText({ version: 1, hosts: [{ ...remembered, port: '22' }] })],
    [
      'two entries for the same host and port',
      fileText({ version: 1, hosts: [remembered, entry('192.168.1.50', 22, ED25519_BBBB)] }),
    ],
  ])('reports %s as unusable and invalid', (_, text) => {
    expect(parseHostKeyFile({ kind: 'text', text })).toEqual({ kind: 'unusable', reason: 'invalid' })
  })
})

describe('serializeHostKeyFile', () => {
  it('writes version 1 JSON with 2-space indentation and a trailing newline', () => {
    const remembered = entry('192.168.1.50', 22, ED25519_AAAA)
    const expected = {
      version: 1,
      hosts: [
        {
          host: '192.168.1.50',
          port: 22,
          keyType: 'ssh-ed25519',
          key: ED25519_AAAA.key,
          firstSeen: EARLIER,
        },
      ],
    }

    expect(serializeHostKeyFile([remembered])).toBe(`${JSON.stringify(expected, null, 2)}\n`)
  })

  it('writes the same text whatever the key order of the entry objects', () => {
    const canonical = entry('192.168.1.50', 22, ED25519_AAAA)
    const reordered: HostKeyEntry = {
      firstSeen: canonical.firstSeen,
      key: canonical.key,
      keyType: canonical.keyType,
      port: canonical.port,
      host: canonical.host,
    }

    expect(serializeHostKeyFile([reordered])).toBe(serializeHostKeyFile([canonical]))
  })

  it('writes a file the parser reads back unchanged', () => {
    const entries = [entry('192.168.1.50', 22, ED25519_AAAA), entry('fe80::1', 22, ECDSA)]

    expect(parseHostKeyFile({ kind: 'text', text: serializeHostKeyFile(entries) })).toEqual({ kind: 'valid', entries })
  })

  it('writes an empty host list for no entries', () => {
    expect(serializeHostKeyFile([])).toBe(`${JSON.stringify({ version: 1, hosts: [] }, null, 2)}\n`)
  })
})

describe('decideHostKey', () => {
  const target = { host: '192.168.1.50', port: 22 }

  it.each([
    ['unreadable', 'remembered', ED25519_AAAA.key],
    ['unreadable', 'different', ED25519_BBBB.key],
    ['empty', 'remembered', ED25519_AAAA.key],
    ['empty', 'different', ED25519_BBBB.key],
    ['invalid', 'remembered', ED25519_AAAA.key],
    ['invalid', 'different', ED25519_BBBB.key],
    ['invalid', 'unreadable', MALFORMED_KEY],
  ] as const)('stops on a file that is %s, whatever the %s key presented', (reason, _, key) => {
    expect(decideHostKey({ kind: 'unusable', reason }, target, key, NOW)).toEqual({ kind: 'unusable' })
  })

  it('matches the identical key remembered for the same host and port', () => {
    const state = validState([entry('192.168.1.50', 22, ED25519_AAAA)])

    expect(decideHostKey(state, target, ED25519_AAAA.key, NOW)).toEqual({ kind: 'match' })
  })

  it('reports a different key of the same type for the same host and port as changed', () => {
    const state = validState([entry('192.168.1.50', 22, ED25519_AAAA)])

    expect(decideHostKey(state, target, ED25519_BBBB.key, NOW)).toEqual({ kind: 'changed' })
  })

  it('reports a key of another algorithm as changed and adds no second entry', () => {
    const state = validState([entry('192.0.2.10', 22, ED25519_AAAA)])

    expect(decideHostKey(state, { host: '192.0.2.10', port: 22 }, ECDSA.key, NOW)).toEqual({ kind: 'changed' })
  })

  it('compares the whole blob, so the same key bytes under another type are changed', () => {
    const state = validState([entry('192.168.1.50', 22, ED25519_AAAA)])

    expect(decideHostKey(state, target, testKey('ssh-ed448', 0xaa).key, NOW)).toEqual({ kind: 'changed' })
  })

  it('trusts the first key seen when no file exists, producing a file with only that entry', () => {
    const added = entry('192.168.1.50', 22, ED25519_AAAA, NOW)

    expect(decideHostKey({ kind: 'absent' }, target, ED25519_AAAA.key, NOW)).toEqual({
      kind: 'first-use',
      nextFileText: serializeHostKeyFile([added]),
    })
  })

  it('adds a new port of a remembered host and keeps the remembered port untouched', () => {
    const port22 = entry('192.168.1.50', 22, ED25519_AAAA)
    const decision = decideHostKey(validState([port22]), { host: '192.168.1.50', port: 2222 }, ED25519_CCCC.key, NOW)

    expect(decision.kind).toBe('first-use')
    const nextEntries = decision.kind === 'first-use' ? entriesOf(decision.nextFileText) : []
    expect(nextEntries).toHaveLength(2)
    expect(nextEntries).toEqual(expect.arrayContaining([port22, entry('192.168.1.50', 2222, ED25519_CCCC, NOW)]))
  })

  it('keeps every other remembered entry unchanged when adding one', () => {
    const others = [
      entry('192.168.1.50', 22, ED25519_AAAA),
      entry('fe80::1', 22, ECDSA),
      entry('plc.local', 2222, ED25519_BBBB),
    ]
    const decision = decideHostKey(validState(others), { host: '10.0.0.7', port: 22 }, ECDSA.key, NOW)

    const nextEntries = decision.kind === 'first-use' ? entriesOf(decision.nextFileText) : []
    expect(nextEntries).toHaveLength(4)
    expect(nextEntries).toEqual(expect.arrayContaining([...others, entry('10.0.0.7', 22, ECDSA, NOW)]))
  })

  it.each([
    ['another host on the same port', 'pi.local'],
    ['the same name in another letter case', 'PLC.local'],
  ])('compares the host exactly: %s is a first use', (_, host) => {
    const state = validState([entry('plc.local', 22, ED25519_AAAA)])

    expect(decideHostKey(state, { host, port: 22 }, ED25519_BBBB.key, NOW).kind).toBe('first-use')
  })

  const statesWithoutTarget: [string, HostKeyFileState][] = [
    ['no file', { kind: 'absent' }],
    ['a file without the target', validState([entry('10.0.0.7', 22, ED25519_AAAA)])],
  ]

  it.each(statesWithoutTarget)('reports a presented key whose type cannot be read as changed, with %s', (_, state) => {
    expect(decideHostKey(state, target, MALFORMED_KEY, NOW)).toEqual({ kind: 'changed' })
  })

  it('leaves the state it decided from unchanged', () => {
    const state = validState([entry('192.168.1.50', 22, ED25519_AAAA)])
    const before = JSON.stringify(state)

    decideHostKey(state, { host: '192.168.1.50', port: 2222 }, ED25519_CCCC.key, NOW)

    expect(JSON.stringify(state)).toBe(before)
  })
})
