/**
 * Derive the credential a TARGET stores from the password a PROJECT holds.
 *
 * How a password is stored is a property of the device, not of the editor, so
 * this runs at build time — the one point that knows both the project and the
 * selected target. The editor used to hash in the user dialog, at a fixed
 * 600 000 PBKDF2 iterations, before the board had necessarily been chosen;
 * nothing ever re-derived it, so a project authored for Runtime v4 and later
 * pointed at a microcontroller carried a credential that device could not
 * verify at any cost it could afford.
 *
 * Schemes are tagged by prefix, which is the convention OpenPLC already uses —
 * Runtime v4's `verify_password` dispatches on `pbkdf2:` vs `$2a$`/`$2b$`
 * (bcrypt) today. Adding one more tag is how this system was already built to
 * grow.
 */

import { pbkdf2Sync, randomBytes } from 'node:crypto'

import type { OpcUaTargetProfile } from '../../../middleware/shared/utils/target-capabilities/types'

/** Salt and digest lengths, matching what the editor emitted historically and
 *  what Runtime v4's `_pbkdf2_hash_password` produces. */
const SALT_BYTES = 16
const KEY_BYTES = 32

type UserLike = {
  type?: string
  username?: string | null
  password?: string | null
  passwordHash?: string | null
}

/** `pbkdf2:sha256:<iterations>$<salt-b64>$<hash-b64>` — byte-for-byte the
 *  format Runtime v4 already produces and consumes. */
function pbkdf2Credential(password: string, iterations: number): string {
  const salt = randomBytes(SALT_BYTES)
  const hash = pbkdf2Sync(password, new Uint8Array(salt), iterations, KEY_BYTES, 'sha256')
  return `pbkdf2:sha256:${iterations}$${salt.toString('base64')}$${hash.toString('base64')}`
}

/** `plain:<password>` — tagged so the runtime never has to guess, and so a
 *  credential's scheme is visible in the generated artefact rather than
 *  inferred from its shape. */
function plainCredential(password: string): string {
  return `plain:${password}`
}

/**
 * Derive the stored credential for one user.
 *
 * Returns `null` when there is nothing to derive (a certificate user, or a
 * password user with neither a password nor a legacy hash).
 */
export function deriveOpcUaCredential(
  user: UserLike,
  profile: Pick<OpcUaTargetProfile, 'passwordScheme' | 'kdfIterations'> | undefined,
  warn?: (message: string) => void,
): string | null {
  if (user.type !== 'password') return null

  const scheme = profile?.passwordScheme ?? 'pbkdf2-sha256'
  const iterations = profile?.kdfIterations ?? 600_000

  if (typeof user.password === 'string' && user.password.length > 0) {
    return scheme === 'plain' ? plainCredential(user.password) : pbkdf2Credential(user.password, iterations)
  }

  // No password to derive from: an older project that only kept the hash.
  // Pass it through — it still works on any target whose scheme produced it —
  // but say so when the target wants something else, because the failure
  // otherwise shows up as a login the device rejects for no visible reason.
  if (typeof user.passwordHash === 'string' && user.passwordHash.length > 0) {
    const looksPbkdf2 = user.passwordHash.startsWith('pbkdf2:')
    const wantsPbkdf2 = scheme === 'pbkdf2-sha256'
    if (looksPbkdf2 !== wantsPbkdf2 && warn) {
      warn(
        `OPC-UA user "${user.username ?? '(unnamed)'}" carries a pre-hashed password from an older ` +
          `project. This target stores credentials as "${scheme}", so the stored hash cannot be ` +
          `re-derived and the user will not be able to log in. Re-enter the password to fix it.`,
      )
    }
    return user.passwordHash
  }

  return null
}

/**
 * Return a copy of `servers` whose OPC-UA users carry the credential this
 * target stores, ready for both consumers: Runtime v4's `opcua_config.json`
 * and the baremetal `OPCUA_USERS[]` table.
 *
 * Pure with respect to its input — the project's plaintext is never mutated,
 * so a rebuild for a different target derives cleanly from the same source.
 */
export function materialiseOpcUaCredentials<T>(
  servers: T,
  profile: Pick<OpcUaTargetProfile, 'passwordScheme' | 'kdfIterations'> | undefined,
  warn?: (message: string) => void,
): T {
  if (!Array.isArray(servers)) return servers

  return servers.map((server: unknown) => {
    const s = server as { protocol?: string; opcuaServerConfig?: { users?: UserLike[] } }
    if (s?.protocol !== 'opcua' || !Array.isArray(s.opcuaServerConfig?.users)) return server

    return {
      ...s,
      opcuaServerConfig: {
        ...s.opcuaServerConfig,
        users: s.opcuaServerConfig.users.map((user) => ({
          ...user,
          passwordHash: deriveOpcUaCredential(user, profile, warn),
        })),
      },
    }
  }) as unknown as T
}
