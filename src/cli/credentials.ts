/**
 * Runtime credentials, resolved once for every command that needs them.
 *
 * `compile`/`upload` and `debug open` had a character-for-character copy of this
 * each — same precedence, same `indexOf(':')` split, same error strings. A fix
 * to one (empty password, whitespace, a colon in the username) would have
 * reached one command and not the other, which is the second-copy failure this
 * whole effort exists to prevent.
 */

import type { ParsedArgs } from './args'
import { stringFlag } from './args'

export interface RuntimeCredentialsInput {
  username: string
  password: string
}

/**
 * Flags first, then the environment.
 *
 * The environment form exists because a flag lands in shell history and CI
 * logs; the flag form exists because it is what a person types once.
 */
export function resolveRuntimeCredentials(args: ParsedArgs): RuntimeCredentialsInput | { error: string } {
  const combined = stringFlag(args, 'credentials') ?? process.env.OPENPLC_CREDENTIALS
  if (combined) {
    // Split at the FIRST colon: a password may contain colons, a username may
    // not. Splitting at the last would silently mangle `op:pa:ss`.
    const separator = combined.indexOf(':')
    if (separator <= 0 || separator === combined.length - 1) {
      return { error: 'Credentials must look like user:password' }
    }
    return { username: combined.slice(0, separator), password: combined.slice(separator + 1) }
  }

  const username = stringFlag(args, 'user') ?? process.env.OPENPLC_USER
  const password = stringFlag(args, 'password') ?? process.env.OPENPLC_PASSWORD
  if (!username || !password) {
    return {
      error:
        'Runtime credentials are required: pass --credentials user:pass (or --user/--password), ' +
        'or set OPENPLC_CREDENTIALS / OPENPLC_USER + OPENPLC_PASSWORD',
    }
  }
  return { username, password }
}
