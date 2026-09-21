import type { PLCServer } from '@root/middleware/shared/ports/types'
import { deriveOpcUaCredential, materialiseOpcUaCredentials } from '../opcua-credentials'

const pbkdf2Profile = { passwordScheme: 'pbkdf2-sha256' as const, kdfIterations: 600_000 }
const plainProfile = { passwordScheme: 'plain' as const, kdfIterations: 600_000 }

const passwordUser = (over: Record<string, unknown> = {}) => ({
  type: 'password',
  username: 'operator',
  password: 'secret123',
  passwordHash: null,
  ...over,
})

describe('deriveOpcUaCredential', () => {
  it('emits the exact format Runtime v4 consumes', async () => {
    const out = await deriveOpcUaCredential(passwordUser(), pbkdf2Profile)
    // pbkdf2:sha256:<iters>$<salt-b64>$<hash-b64>
    expect(out).toMatch(/^pbkdf2:sha256:600000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/)
  })

  it('defaults to PBKDF2 at 600 000 when the target declares nothing', async () => {
    // Backward compatibility: every target behaved this way before the scheme
    // was configurable, so an undefined profile must not change behaviour.
    const out = await deriveOpcUaCredential(passwordUser(), undefined)
    expect(out).toMatch(/^pbkdf2:sha256:600000\$/)
  })

  it('emits a tagged plaintext credential when the target asks for it', async () => {
    expect(await deriveOpcUaCredential(passwordUser(), plainProfile)).toBe('plain:secret123')
  })

  it('salts each derivation, so two users with one password differ', async () => {
    const a = await deriveOpcUaCredential(passwordUser(), pbkdf2Profile)
    const b = await deriveOpcUaCredential(passwordUser(), pbkdf2Profile)
    expect(a).not.toBe(b)
  })

  it('ignores certificate users', async () => {
    expect(await deriveOpcUaCredential({ type: 'certificate', username: null }, plainProfile)).toBeNull()
  })

  it('returns null when there is nothing to derive from', async () => {
    expect(await deriveOpcUaCredential(passwordUser({ password: null }), plainProfile)).toBeNull()
  })

  it('passes a legacy hash through untouched', async () => {
    const legacy = 'pbkdf2:sha256:600000$c2FsdA==$aGFzaA=='
    const out = await deriveOpcUaCredential(passwordUser({ password: null, passwordHash: legacy }), pbkdf2Profile)
    expect(out).toBe(legacy)
  })

  it('warns when a legacy hash cannot serve the target scheme', async () => {
    // The device would simply reject the login; without this the user has no
    // way to know why.
    const warn = jest.fn()
    await deriveOpcUaCredential(
      passwordUser({ password: null, passwordHash: 'pbkdf2:sha256:600000$c2FsdA==$aGFzaA==' }),
      plainProfile,
      warn,
    )
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('operator'))
  })

  it('prefers the plaintext password over a stale legacy hash', async () => {
    const out = await deriveOpcUaCredential(passwordUser({ passwordHash: 'pbkdf2:sha256:1$x$y' }), plainProfile)
    expect(out).toBe('plain:secret123')
  })
})

describe('materialiseOpcUaCredentials', () => {
  // Minimal shapes: materialise only looks at `protocol` and
  // `opcuaServerConfig.users`. Cast at the boundary rather than build two full
  // PLCServer objects for a test that exercises neither's other fields.
  const servers = () =>
    [
      { protocol: 'modbus', modbusSlaveConfig: {} },
      { protocol: 'opcua', opcuaServerConfig: { users: [passwordUser()] } },
    ] as unknown as PLCServer[]

  it('rewrites only the OPC-UA server, leaving others identical', async () => {
    const input = servers()
    const out = (await materialiseOpcUaCredentials(input, plainProfile))!
    expect(out[0]).toBe(input[0])
    expect(
      (out[1] as never as { opcuaServerConfig: { users: { passwordHash: string }[] } }).opcuaServerConfig.users[0]
        .passwordHash,
    ).toBe('plain:secret123')
  })

  it('does not mutate the project, so a rebuild for another target is clean', async () => {
    const input = servers()
    await materialiseOpcUaCredentials(input, plainProfile)
    const opcua = input[1] as { opcuaServerConfig: { users: { password: string; passwordHash: string | null }[] } }
    expect(opcua.opcuaServerConfig.users[0].password).toBe('secret123')
    expect(opcua.opcuaServerConfig.users[0].passwordHash).toBeNull()
  })

  it('derives a different credential for a different target from the same project', async () => {
    const input = servers()
    const forLogo = (await materialiseOpcUaCredentials(input, plainProfile)) as never as Array<{
      opcuaServerConfig?: { users: { passwordHash: string }[] }
    }>
    const forV4 = (await materialiseOpcUaCredentials(input, pbkdf2Profile)) as never as typeof forLogo
    expect(forLogo[1].opcuaServerConfig!.users[0].passwordHash).toBe('plain:secret123')
    expect(forV4[1].opcuaServerConfig!.users[0].passwordHash).toMatch(/^pbkdf2:sha256:600000\$/)
  })

  it('tolerates a project with no servers', async () => {
    expect(await materialiseOpcUaCredentials(undefined, plainProfile)).toBeUndefined()
  })
})

describe('PBKDF2 vector — WebCrypto must match what node:crypto produced', () => {
  // The derivation moved off `node:crypto` onto WebCrypto so openplc-web can
  // evaluate this module in the browser. That swap is only safe if the OUTPUT
  // is unchanged: a credential already stored on a device has to keep
  // verifying, and Runtime v4 re-derives with its own PBKDF2 to check.
  //
  // This is a fixed vector, not a comparison against `node:crypto` — pinning
  // the bytes catches a regression even on a platform that has no node:crypto
  // to compare against, which is the whole point of the move.
  it('derives the known PBKDF2-SHA256 vector', async () => {
    const salt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
    const key = await globalThis.crypto.subtle.importKey('raw', new TextEncoder().encode('s3cret'), 'PBKDF2', false, [
      'deriveBits',
    ])
    const bits = await globalThis.crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' },
      key,
      32 * 8,
    )
    let binary = ''
    for (const byte of new Uint8Array(bits)) binary += String.fromCharCode(byte)
    // Produced by `pbkdf2Sync('s3cret', salt, 600000, 32, 'sha256')` before the move.
    expect(btoa(binary)).toBe('b6uAWgTmq4hP7O+nkIhoy5R5A6tkuTJ8PrsJYaIGfrE=')
  })
})
