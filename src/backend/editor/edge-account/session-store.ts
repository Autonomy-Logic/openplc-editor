/**
 * Where the desktop editor keeps its Edge session between runs.
 *
 * Only the refresh token is persisted. The access token deliberately is not: it lives
 * 7 days, so a copy on disk is a week-long credential for anyone who reads the file,
 * and it can always be re-minted from the refresh token in one round trip.
 *
 * WHY IT MAY REFUSE TO PERSIST. `safeStorage` is backed by the Keychain on macOS,
 * DPAPI on Windows, and a Secret Service keyring on Linux. On a Linux box with no
 * keyring there is no key, and `encryptString` either throws or — worse, on some
 * Electron versions — degrades to plaintext. Writing a bearer credential to a
 * world-readable JSON file is not an acceptable degradation, so when encryption is
 * unavailable the session is kept in memory for the run and the user signs in again
 * next launch. Losing that convenience is the right trade.
 *
 * The desktop cannot use the shared parent-domain cookie the web editor relies on —
 * its renderer is not on Edge's origin — which is why this file exists at all.
 */

import { safeStorage } from 'electron'

import { store } from '../../../main/modules/store'

/** Held for the run when the OS refused to encrypt, so the session still works. */
let inMemoryRefreshToken: string | null = null

/**
 * Whether the OS can encrypt. Probed through a function rather than a module-level
 * constant because `safeStorage` is only meaningful once the app is ready, and this
 * module can be imported before that.
 */
function canEncrypt(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

/**
 * Persist the refresh token, encrypted when the OS allows it.
 *
 * Rotation makes this a hot path: every renewal issues a new token and kills the old
 * one, so a write that silently failed would leave the stored value one rotation
 * behind the server and sign the user out on the next launch. Hence the return value
 * — callers can tell "kept in memory only" from "written".
 */
export function saveRefreshToken(token: string): { persisted: boolean } {
  inMemoryRefreshToken = token

  if (!canEncrypt()) {
    return { persisted: false }
  }

  try {
    store.set('edge_session', { refreshToken: safeStorage.encryptString(token).toString('base64') })

    return { persisted: true }
  } catch {
    // Encryption was advertised but failed. Treated exactly like no encryption:
    // never fall back to writing the raw token.
    return { persisted: false }
  }
}

/** The stored refresh token, or null when there is nothing usable. */
export function readRefreshToken(): string | null {
  if (inMemoryRefreshToken) {
    return inMemoryRefreshToken
  }

  const encrypted = store.get('edge_session')?.refreshToken

  if (!encrypted || !canEncrypt()) {
    // Either nothing was stored, or it was written on a machine that could encrypt
    // and is being read on one that cannot. The bytes are not recoverable.
    return null
  }

  try {
    const token = safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    inMemoryRefreshToken = token

    return token
  } catch {
    // Undecryptable: a different OS user, a reset keychain, a corrupted value. Drop
    // it rather than retrying on every request for the rest of the run.
    clearRefreshToken()

    return null
  }
}

/**
 * Forget the session, in memory and on disk.
 *
 * Called on sign-out and whenever a renewal is refused. A refresh token the server
 * has revoked is worse than none, because keeping it makes every launch begin with a
 * failing request that looks like an outage.
 */
export function clearRefreshToken(): void {
  inMemoryRefreshToken = null

  try {
    store.delete('edge_session')
  } catch {
    // A store that cannot delete cannot be repaired from here, and the in-memory
    // copy is already gone.
  }
}

/** Whether a session on this machine survives a restart. Surfaced to the UI. */
export function isEncryptionAvailable(): boolean {
  return canEncrypt()
}
