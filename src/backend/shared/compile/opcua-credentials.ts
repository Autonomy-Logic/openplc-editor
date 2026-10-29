/**
 * Derive the credential a target stores from the password a project holds.
 *
 * How a password is stored is a property of the device, not of the editor, so
 * this runs at build time, the one point that knows both the project and the
 * selected target. Hashing in the user dialog at a fixed iteration count, before
 * the board had necessarily been chosen, left projects carrying a credential the
 * selected device could not verify at any cost it could afford.
 *
 * Schemes are tagged by prefix, the convention Runtime v4's `verify_password`
 * already dispatches on.
 */

import type { PLCServer } from '../../../middleware/shared/ports/types'
import type { OpcUaTargetProfile } from '../../../middleware/shared/utils/target-capabilities/types'

/** Salt and digest lengths, matching what the editor emitted historically and
 *  what Runtime v4's `_pbkdf2_hash_password` produces. */
const SALT_BYTES = 16
const KEY_BYTES = 32

/**
 * WebCrypto, not `node:crypto`.
 *
 * This module is on the shared compile surface, so openplc-web bundles it and
 * EVALUATES it in the browser. A top-level `import { pbkdf2Sync } from
 * 'node:crypto'` therefore took the whole web app down at boot -- Vite
 * externalises the module and touching any member throws, before a single
 * component rendered.
 *
 * A lazy import would only have moved that failure: the derivation runs inside
 * the `isRuntimeV4` branch of the pipeline, and reaching a Runtime v4 device
 * through the orchestrator is precisely what web is FOR, so the browser really
 * does have to derive credentials.
 *
 * `globalThis.crypto.subtle` is the one PBKDF2 both platforms already have --
 * native in the browser and in Node since 15 -- which keeps a single
 * implementation rather than a platform port, and keeps it native: at the
 * default 600_000 iterations a pure-JS fallback would block the UI thread for
 * seconds. The cost is that deriving is now async, since `subtle` has no
 * synchronous form.
 */
function webcrypto(): Crypto {
  const c = globalThis.crypto
  if (!c?.subtle) {
    throw new Error(
      'WebCrypto is unavailable, so OPC-UA credentials cannot be derived. ' +
        'This needs a secure context in the browser (https or localhost) and Node 15 or newer.',
    )
  }
  return c
}

/** Base64 without `Buffer`, which the browser does not have. */
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

type UserLike = {
  type?: string
  username?: string | null
  password?: string | null
  passwordHash?: string | null
}

/** `pbkdf2:sha256:<iterations>$<salt-b64>$<hash-b64>`, byte-for-byte the format
 *  Runtime v4 produces and consumes. */
async function pbkdf2Credential(password: string, iterations: number): Promise<string> {
  const crypto = webcrypto()
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, KEY_BYTES * 8)
  return `pbkdf2:sha256:${iterations}$${toBase64(salt)}$${toBase64(new Uint8Array(bits))}`
}

/** `plain:<password>`, tagged so the runtime never has to guess and a
 *  credential's scheme is visible in the generated artefact. */
function plainCredential(password: string): string {
  return `plain:${password}`
}

/**
 * Derive the stored credential for one user.
 *
 * Returns `null` when there is nothing to derive (a certificate user, or a
 * password user with neither a password nor a legacy hash).
 */
export async function deriveOpcUaCredential(
  user: UserLike,
  profile: Pick<OpcUaTargetProfile, 'passwordScheme' | 'kdfIterations'> | undefined,
  warn?: (message: string) => void,
): Promise<string | null> {
  if (user.type !== 'password') return null

  const scheme = profile?.passwordScheme ?? 'pbkdf2-sha256'
  const iterations = profile?.kdfIterations ?? 600_000

  if (typeof user.password === 'string' && user.password.length > 0) {
    return scheme === 'plain' ? plainCredential(user.password) : await pbkdf2Credential(user.password, iterations)
  }

  // No password to derive from: an older project that only kept the hash. Pass
  // it through, but say so when the target wants something else, because the
  // failure otherwise shows up as a login the device rejects for no visible reason.
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
 * Return a copy of `servers` whose OPC-UA users carry the credential this target
 * stores, ready for both Runtime v4's `opcua_config.json` and the baremetal
 * `OPCUA_USERS[]` table. The project's plaintext is never mutated.
 */
export async function materialiseOpcUaCredentials(
  servers: PLCServer[] | undefined,
  profile: Pick<OpcUaTargetProfile, 'passwordScheme' | 'kdfIterations'> | undefined,
  warn?: (message: string) => void,
): Promise<PLCServer[] | undefined> {
  if (!servers) return servers

  return Promise.all(
    servers.map(async (server) => {
      const users = server.opcuaServerConfig?.users
      if (server.protocol !== 'opcua' || !Array.isArray(users)) return server

      return {
        ...server,
        opcuaServerConfig: {
          ...server.opcuaServerConfig,
          users: await Promise.all(
            (users as UserLike[]).map(async (user) => ({
              ...user,
              passwordHash: await deriveOpcUaCredential(user, profile, warn),
            })),
          ),
        },
      } as PLCServer
    }),
  )
}
