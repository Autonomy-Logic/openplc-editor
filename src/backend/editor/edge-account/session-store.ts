/**
 * Where the desktop editor keeps its Edge session between runs. Only the refresh token
 * is persisted (the access token is short-lived and always re-mintable); when
 * `safeStorage` can't encrypt, the session is kept in memory only rather than writing plaintext.
 */

import { safeStorage } from 'electron'

import { store } from '../../../main/modules/store'

/** Held for the run when the OS refused to encrypt, so the session still works. */
let inMemoryRefreshToken: string | null = null

/**
 * Whether the OS can encrypt; probed lazily since `safeStorage` is only meaningful once
 * the app is ready. On Linux without a keyring, `isEncryptionAvailable()` can answer
 * true while the backend is `basic_text` (a hardcoded key) — treated as no encryption.
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
 * Persists the refresh token, encrypted when the OS allows it. Returns whether it was
 * actually written, since a silent failure would leave a stale token that signs the user out on the next launch.
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

/**
 * Drops what is on disk, keeping the in-memory copy — used when a rotation couldn't be
 * persisted, so disk doesn't keep a token the server already retired.
 */
function forgetStoredSession(): void {
  try {
    store.delete('edge_session')
  } catch {
    // A store that cannot delete cannot be repaired from here.
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
 * Forgets the session, in memory and on disk — called on sign-out and when a renewal is
 * refused, since a revoked token left in place makes every launch look like an outage.
 */
export function clearRefreshToken(): void {
  inMemoryRefreshToken = null
  forgetStoredSession()
}

/** Whether a session on this machine survives a restart. Surfaced to the UI. */
export function isEncryptionAvailable(): boolean {
  return canEncrypt()
}
