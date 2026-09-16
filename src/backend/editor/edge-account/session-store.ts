/**
 * Only the refresh token is persisted; the access token is always re-mintable. When
 * `safeStorage` cannot encrypt, the session stays in memory rather than hitting disk.
 */

import { safeStorage } from 'electron'

import { store } from '../../../main/modules/store'

/** Held for the run when the OS refused to encrypt, so the session still works. */
let inMemoryRefreshToken: string | null = null

/**
 * Probed lazily: `safeStorage` is only meaningful once the app is ready. On Linux without
 * a keyring it answers true while the backend is `basic_text`, a hardcoded key.
 */
function canEncrypt(): boolean {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      return false
    }

    // `getSelectedStorageBackend` exists on Linux only and throws elsewhere.
    return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'
  } catch {
    return false
  }
}

/**
 * Reports whether the token was actually written: a silent failure would leave a stale
 * one on disk that signs the user out on the next launch.
 */
export function saveRefreshToken(token: string): { persisted: boolean } {
  inMemoryRefreshToken = token

  if (!canEncrypt()) {
    forgetStoredSession()

    return { persisted: false }
  }

  try {
    store.set('edge_session', { refreshToken: safeStorage.encryptString(token).toString('base64') })

    return { persisted: true }
  } catch {
    // Encryption was advertised but failed. Treated exactly like no encryption:
    // never fall back to writing the raw token.
    forgetStoredSession()

    return { persisted: false }
  }
}

/** Drops what is on disk, keeping the in-memory copy, so disk never holds a token the server already retired. */
function forgetStoredSession(): void {
  try {
    store.delete('edge_session')
  } catch {
    // A store that cannot delete cannot be repaired from here.
  }
}

export function readRefreshToken(): string | null {
  if (inMemoryRefreshToken) {
    return inMemoryRefreshToken
  }

  const encrypted = store.get('edge_session')?.refreshToken

  if (!encrypted || !canEncrypt()) {
    // Nothing stored, or written where encryption worked and read where it does not.
    return null
  }

  try {
    const token = safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    inMemoryRefreshToken = token

    return token
  } catch {
    // Undecryptable (another OS user, a reset keychain): dropped rather than retried on
    // every request for the rest of the run.
    clearRefreshToken()

    return null
  }
}

/** Also called when a renewal is refused: a revoked token left in place makes every launch look like an outage. */
export function clearRefreshToken(): void {
  inMemoryRefreshToken = null
  forgetStoredSession()
}

/** Whether a session on this machine survives a restart. */
export function isEncryptionAvailable(): boolean {
  return canEncrypt()
}
