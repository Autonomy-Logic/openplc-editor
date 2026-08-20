import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { mintSessionId, type SessionRecord, SessionRegistry, socketPathFor } from '../session/registry'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'openplc-cli-registry-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const record = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  sessionId: 'aaaaaaaaaaaa',
  pid: 4242,
  socketPath: join(dir, 'aaaaaaaaaaaa.sock'),
  target: 'OpenPLC Runtime v4',
  projectPath: '/projects/demo',
  programMd5: 'abc',
  startedAt: '2026-08-20T10:00:00.000Z',
  ...overrides,
})

const alwaysAlive = () => true
const alwaysDead = () => false

describe('mintSessionId', () => {
  it('mints distinct ids so concurrent opens cannot collide', () => {
    const ids = new Set(Array.from({ length: 500 }, () => mintSessionId()))
    expect(ids.size).toBe(500)
  })
})

describe('socketPathFor', () => {
  it('uses a socket file on posix and the pipe namespace on win32', () => {
    expect(socketPathFor('/reg', 'abc', 'darwin')).toBe(join('/reg', 'abc.sock'))
    expect(socketPathFor('/reg', 'abc', 'win32')).toBe('\\\\.\\pipe\\openplc-debug-abc')
  })
})

describe('SessionRegistry', () => {
  it('round-trips a record, creating the directory on demand', () => {
    const nested = join(dir, 'deeper', 'still')
    const registry = new SessionRegistry(nested, alwaysAlive)

    registry.register(record())

    expect(registry.get('aaaaaaaaaaaa')).toEqual(record())
  })

  it('returns undefined for an unknown session', () => {
    expect(new SessionRegistry(dir, alwaysAlive).get('nope')).toBeUndefined()
  })

  it('reaps a record whose owning process is gone instead of returning it', () => {
    // The failure this prevents: a client dialling a socket nobody is
    // listening on and hanging until its timeout.
    const registry = new SessionRegistry(dir, alwaysDead)
    registry.register(record())

    expect(registry.get('aaaaaaaaaaaa')).toBeUndefined()
    expect(readdirSync(dir)).toEqual([])
  })

  it('lists only live sessions, oldest first', () => {
    const registry = new SessionRegistry(dir, (pid) => pid !== 999)
    registry.register(record({ sessionId: 'newer', startedAt: '2026-08-20T12:00:00.000Z' }))
    registry.register(record({ sessionId: 'older', startedAt: '2026-08-20T09:00:00.000Z' }))
    registry.register(record({ sessionId: 'dead', pid: 999 }))

    expect(registry.list().map((r) => r.sessionId)).toEqual(['older', 'newer'])
  })

  it('ignores non-record files in the registry directory', () => {
    const registry = new SessionRegistry(dir, alwaysAlive)
    registry.register(record())
    writeFileSync(join(dir, 'notes.txt'), 'ignore me')

    expect(registry.list().map((r) => r.sessionId)).toEqual(['aaaaaaaaaaaa'])
  })

  it('treats a malformed record as absent rather than throwing', () => {
    const registry = new SessionRegistry(dir, alwaysAlive)
    writeFileSync(join(dir, 'broken.json'), '{ not json')
    writeFileSync(join(dir, 'wrong-shape.json'), JSON.stringify({ sessionId: 'x' }))

    expect(registry.list()).toEqual([])
    expect(registry.get('wrong-shape')).toBeUndefined()
  })

  it('returns an empty list when the directory does not exist yet', () => {
    expect(new SessionRegistry(join(dir, 'absent'), alwaysAlive).list()).toEqual([])
    expect(new SessionRegistry(join(dir, 'absent'), alwaysAlive).reapStale()).toEqual([])
  })

  it('unregisters a session on clean shutdown', () => {
    const registry = new SessionRegistry(dir, alwaysAlive)
    registry.register(record())

    registry.unregister('aaaaaaaaaaaa')

    expect(registry.get('aaaaaaaaaaaa')).toBeUndefined()
    expect(readdirSync(dir)).toEqual([])
  })

  it('unregistering an unknown session is a no-op, not an error', () => {
    expect(() => new SessionRegistry(dir, alwaysAlive).unregister('ghost')).not.toThrow()
  })

  it('reapStale reports the dead sessions it cleaned so an operator sees them', () => {
    // Reported, not silent: a session that died may have left forces pinned.
    const registry = new SessionRegistry(dir, (pid) => pid === 1)
    registry.register(record({ sessionId: 'live', pid: 1 }))
    registry.register(record({ sessionId: 'dead1', pid: 111 }))
    registry.register(record({ sessionId: 'dead2', pid: 222 }))

    expect(registry.reapStale().sort()).toEqual(['dead1', 'dead2'])
    expect(registry.list().map((r) => r.sessionId)).toEqual(['live'])
  })

  it('reapStale deletes unreadable records, which can never be dialled', () => {
    const registry = new SessionRegistry(dir, alwaysAlive)
    writeFileSync(join(dir, 'garbage.json'), 'not json at all')

    registry.reapStale()

    expect(readdirSync(dir)).toEqual([])
  })

  it('finds a reusable session for the same project and target', () => {
    // Reuse matters because single-client targets never answer a second socket.
    const registry = new SessionRegistry(dir, alwaysAlive)
    registry.register(record({ sessionId: 'match' }))

    expect(registry.findReusable('/projects/demo', 'OpenPLC Runtime v4')?.sessionId).toBe('match')
    expect(registry.findReusable('/projects/other', 'OpenPLC Runtime v4')).toBeUndefined()
    expect(registry.findReusable('/projects/demo', 'OpenPLC Simulator')).toBeUndefined()
  })

  it('does not try to unlink a win32 pipe name as if it were a file', () => {
    const registry = new SessionRegistry(dir, alwaysDead)
    registry.register(record({ socketPath: '\\\\.\\pipe\\openplc-debug-aaaaaaaaaaaa' }))

    expect(() => registry.get('aaaaaaaaaaaa')).not.toThrow()
    expect(readdirSync(dir)).toEqual([])
  })
})
