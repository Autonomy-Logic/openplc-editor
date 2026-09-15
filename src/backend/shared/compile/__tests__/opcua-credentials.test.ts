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
  it('emits the exact format Runtime v4 consumes', () => {
    const out = deriveOpcUaCredential(passwordUser(), pbkdf2Profile)
    // pbkdf2:sha256:<iters>$<salt-b64>$<hash-b64>
    expect(out).toMatch(/^pbkdf2:sha256:600000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/)
  })

  it('defaults to PBKDF2 at 600 000 when the target declares nothing', () => {
    // Backward compatibility: every target behaved this way before the scheme
    // was configurable, so an undefined profile must not change behaviour.
    const out = deriveOpcUaCredential(passwordUser(), undefined)
    expect(out).toMatch(/^pbkdf2:sha256:600000\$/)
  })

  it('emits a tagged plaintext credential when the target asks for it', () => {
    expect(deriveOpcUaCredential(passwordUser(), plainProfile)).toBe('plain:secret123')
  })

  it('salts each derivation, so two users with one password differ', () => {
    const a = deriveOpcUaCredential(passwordUser(), pbkdf2Profile)
    const b = deriveOpcUaCredential(passwordUser(), pbkdf2Profile)
    expect(a).not.toBe(b)
  })

  it('ignores certificate users', () => {
    expect(deriveOpcUaCredential({ type: 'certificate', username: null }, plainProfile)).toBeNull()
  })

  it('returns null when there is nothing to derive from', () => {
    expect(deriveOpcUaCredential(passwordUser({ password: null }), plainProfile)).toBeNull()
  })

  it('passes a legacy hash through untouched', () => {
    const legacy = 'pbkdf2:sha256:600000$c2FsdA==$aGFzaA=='
    const out = deriveOpcUaCredential(passwordUser({ password: null, passwordHash: legacy }), pbkdf2Profile)
    expect(out).toBe(legacy)
  })

  it('warns when a legacy hash cannot serve the target scheme', () => {
    // The device would simply reject the login; without this the user has no
    // way to know why.
    const warn = jest.fn()
    deriveOpcUaCredential(
      passwordUser({ password: null, passwordHash: 'pbkdf2:sha256:600000$c2FsdA==$aGFzaA==' }),
      plainProfile,
      warn,
    )
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('operator'))
  })

  it('prefers the plaintext password over a stale legacy hash', () => {
    const out = deriveOpcUaCredential(passwordUser({ passwordHash: 'pbkdf2:sha256:1$x$y' }), plainProfile)
    expect(out).toBe('plain:secret123')
  })
})

describe('materialiseOpcUaCredentials', () => {
  const servers = () => [
    { protocol: 'modbus', modbusSlaveConfig: {} },
    { protocol: 'opcua', opcuaServerConfig: { users: [passwordUser()] } },
  ]

  it('rewrites only the OPC-UA server, leaving others identical', () => {
    const input = servers()
    const out = materialiseOpcUaCredentials(input, plainProfile) as typeof input
    expect(out[0]).toBe(input[0])
    expect(
      (out[1] as never as { opcuaServerConfig: { users: { passwordHash: string }[] } }).opcuaServerConfig.users[0]
        .passwordHash,
    ).toBe('plain:secret123')
  })

  it('does not mutate the project, so a rebuild for another target is clean', () => {
    const input = servers()
    materialiseOpcUaCredentials(input, plainProfile)
    const opcua = input[1] as { opcuaServerConfig: { users: { password: string; passwordHash: string | null }[] } }
    expect(opcua.opcuaServerConfig.users[0].password).toBe('secret123')
    expect(opcua.opcuaServerConfig.users[0].passwordHash).toBeNull()
  })

  it('derives a different credential for a different target from the same project', () => {
    const input = servers()
    const forLogo = materialiseOpcUaCredentials(input, plainProfile) as never as Array<{
      opcuaServerConfig?: { users: { passwordHash: string }[] }
    }>
    const forV4 = materialiseOpcUaCredentials(input, pbkdf2Profile) as never as typeof forLogo
    expect(forLogo[1].opcuaServerConfig!.users[0].passwordHash).toBe('plain:secret123')
    expect(forV4[1].opcuaServerConfig!.users[0].passwordHash).toMatch(/^pbkdf2:sha256:600000\$/)
  })

  it('tolerates a project with no servers', () => {
    expect(materialiseOpcUaCredentials(undefined, plainProfile)).toBeUndefined()
  })
})
