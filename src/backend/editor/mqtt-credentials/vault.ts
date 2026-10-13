// readSecret is for main-process deploy code only; nothing here returns the secret to the renderer.

import { createHash } from 'crypto'
import { z } from 'zod'

import { validateMqttCredentialSecret } from '../../../frontend/utils/mqtt/credentials/validate'
import type {
  MqttCredentialBinding,
  MqttCredentialPersistence,
  MqttCredentialPresence,
  MqttCredentialScope,
  MqttCredentialSecret,
  MqttCredentialWriteResult,
} from '../../../middleware/shared/ports/mqtt-credential-port'
import {
  MqttCredentialBindingInputSchema,
  MqttCredentialScopeInputSchema,
  MqttCredentialSecretInputSchema,
} from './ipc-input'

export const MQTT_CREDENTIAL_VAULT_FORMAT = 'openplc-editor-mqtt-credentials'
export const MQTT_CREDENTIAL_VAULT_VERSION = 1
export const MQTT_CREDENTIAL_VAULT_MAX_ENTRIES = 256

export interface MqttVaultCipher {
  canEncrypt(): boolean
  encrypt(plain: string): Buffer
  decrypt(sealed: Buffer): string
}

export interface MqttVaultStorage {
  /** Null when the file does not exist; throws when it exists but cannot be read. */
  read(): Promise<string | null>
  write(content: string): Promise<void>
}

export type MqttVaultLog = (level: 'info' | 'warn', line: string) => void

export type MqttVaultSecretRead =
  | { ok: true; secret: MqttCredentialSecret }
  | { ok: false; reason: 'missing' | 'binding_mismatch' }

export interface MqttCredentialVault {
  persistence(): MqttCredentialPersistence
  getPresence(scope: MqttCredentialScope): Promise<MqttCredentialPresence>
  put(
    scope: MqttCredentialScope,
    secret: MqttCredentialSecret,
    binding: MqttCredentialBinding,
  ): Promise<MqttCredentialWriteResult>
  remove(scope: MqttCredentialScope): Promise<void>
  readSecret(scope: MqttCredentialScope, binding: MqttCredentialBinding): Promise<MqttVaultSecretRead>
  forgetProject(projectKey: string): Promise<number>
}

const StoredEntrySchema = z
  .object({
    scope: MqttCredentialScopeInputSchema,
    method: z.enum(['username_password', 'client_certificate']),
    binding: MqttCredentialBindingInputSchema,
    updatedAt: z.string().max(64),
    sealed: z.string().min(1),
  })
  .strict()

type StoredEntry = z.infer<typeof StoredEntrySchema>

const VaultDocumentSchema = z
  .object({
    format: z.literal(MQTT_CREDENTIAL_VAULT_FORMAT),
    version: z.literal(MQTT_CREDENTIAL_VAULT_VERSION),
    entries: z.array(StoredEntrySchema).max(MQTT_CREDENTIAL_VAULT_MAX_ENTRIES),
  })
  .strict()

type VaultDocument = z.infer<typeof VaultDocumentSchema>

const SealedPayloadSchema = z
  .object({
    scopeKey: z.string(),
    binding: MqttCredentialBindingInputSchema,
    secret: MqttCredentialSecretInputSchema,
  })
  .strict()

interface MemoryEntry {
  scope: MqttCredentialScope
  binding: MqttCredentialBinding
  secret: MqttCredentialSecret
  updatedAt: string
}

const scopeKeyOf = (scope: MqttCredentialScope): string =>
  JSON.stringify([scope.projectKey, scope.targetKey, scope.serverName])

/** Stable, non-reversible label for log lines, so they name an entry without its project path or target. */
export const mqttCredentialEntryLabel = (scope: MqttCredentialScope): string =>
  createHash('sha256').update(scopeKeyOf(scope)).digest('hex').slice(0, 12)

const sameBinding = (a: MqttCredentialBinding, b: MqttCredentialBinding): boolean =>
  a.host === b.host &&
  a.port === b.port &&
  a.tlsEnabled === b.tlsEnabled &&
  a.clientId === b.clientId &&
  a.method === b.method

const copyBinding = (binding: MqttCredentialBinding): MqttCredentialBinding => ({
  host: binding.host,
  port: binding.port,
  tlsEnabled: binding.tlsEnabled,
  clientId: binding.clientId,
  method: binding.method,
})

const copySecret = (secret: MqttCredentialSecret): MqttCredentialSecret =>
  secret.method === 'username_password'
    ? { method: secret.method, username: secret.username, password: secret.password }
    : {
        method: secret.method,
        certificatePem: secret.certificatePem,
        privateKeyPem: secret.privateKeyPem,
        ...(secret.privateKeyPassphrase ? { privateKeyPassphrase: secret.privateKeyPassphrase } : {}),
      }

const presenceOf = (
  method: MqttCredentialBinding['method'],
  binding: MqttCredentialBinding,
  updatedAt: string,
): MqttCredentialPresence => ({
  present: true,
  method,
  binding: copyBinding(binding),
  ...(method === 'username_password' ? { usernameSet: true } : {}),
  updatedAt,
})

const emptyDocument = (): VaultDocument => ({
  format: MQTT_CREDENTIAL_VAULT_FORMAT,
  version: MQTT_CREDENTIAL_VAULT_VERSION,
  entries: [],
})

export interface MqttCredentialVaultDeps {
  cipher: MqttVaultCipher
  storage: MqttVaultStorage
  log: MqttVaultLog
  now?: () => Date
}

export const createMqttCredentialVault = ({
  cipher,
  storage,
  log,
  now = () => new Date(),
}: MqttCredentialVaultDeps): MqttCredentialVault => {
  const memory = new Map<string, MemoryEntry>()
  // Set when sealing or writing failed this run, so the UI stops promising a persistence it cannot give.
  let degraded = false
  let queue: Promise<unknown> = Promise.resolve()

  const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }

  const audit = (event: string, scope: MqttCredentialScope | null, fields: Record<string, string>): void => {
    const parts = [`event=${event}`, ...Object.entries(fields).map(([key, value]) => `${key}=${value}`)]
    if (scope) parts.push(`entry=${mqttCredentialEntryLabel(scope)}`)
    const routine = fields.result === 'ok' || fields.result === 'removed' || fields.result === 'absent'
    log(routine ? 'info' : 'warn', `MQTT credential store: ${parts.join(' ')}`)
  }

  const canSeal = (): boolean => {
    try {
      return cipher.canEncrypt()
    } catch {
      return false
    }
  }

  const readDocument = async (): Promise<VaultDocument> => {
    let raw: string | null
    try {
      raw = await storage.read()
    } catch {
      audit('read', null, { result: 'unreadable' })
      return emptyDocument()
    }
    if (raw === null) return emptyDocument()
    try {
      const parsed = VaultDocumentSchema.safeParse(JSON.parse(raw))
      if (parsed.success) return parsed.data
    } catch {
      // Falls through to the corrupt case below.
    }
    audit('read', null, { result: 'corrupt' })
    return emptyDocument()
  }

  const writeDocument = (document: VaultDocument): Promise<void> => storage.write(`${JSON.stringify(document)}\n`)

  /** Drops the entries of one scope from disk without decrypting anything. */
  const dropStored = async (scopeKey: string): Promise<boolean> => {
    const document = await readDocument()
    const kept = document.entries.filter((entry) => scopeKeyOf(entry.scope) !== scopeKey)
    if (kept.length === document.entries.length) return false
    await writeDocument({ ...document, entries: kept })
    return true
  }

  const unseal = (entry: StoredEntry): MqttCredentialSecret | null => {
    try {
      const payload = SealedPayloadSchema.safeParse(JSON.parse(cipher.decrypt(Buffer.from(entry.sealed, 'base64'))))
      if (!payload.success) return null
      const { scopeKey, binding, secret } = payload.data
      // A sealed blob copied onto another entry would otherwise answer for a scope or broker it was not entered for.
      if (scopeKey !== scopeKeyOf(entry.scope) || !sameBinding(binding, entry.binding)) return null
      if (secret.method !== entry.method) return null
      return copySecret(secret)
    } catch {
      return null
    }
  }

  /** The usable stored entry and its secret, discarding one that no longer opens. */
  const openStored = async (
    scope: MqttCredentialScope,
  ): Promise<{ entry: StoredEntry; secret: MqttCredentialSecret } | null> => {
    if (!canSeal()) return null
    const scopeKey = scopeKeyOf(scope)
    const entry = (await readDocument()).entries.find((candidate) => scopeKeyOf(candidate.scope) === scopeKey)
    if (!entry) return null
    const secret = unseal(entry)
    if (secret) return { entry, secret }
    try {
      await dropStored(scopeKey)
      audit('discard', scope, { result: 'unreadable' })
    } catch {
      audit('discard', scope, { result: 'write_failed' })
    }
    return null
  }

  const countScopes = async (): Promise<Set<string>> => {
    const keys = new Set(memory.keys())
    for (const entry of (await readDocument()).entries) keys.add(scopeKeyOf(entry.scope))
    return keys
  }

  const keepInMemory = (
    scope: MqttCredentialScope,
    secret: MqttCredentialSecret,
    binding: MqttCredentialBinding,
    updatedAt: string,
  ) => {
    memory.set(scopeKeyOf(scope), {
      scope: { ...scope },
      secret: copySecret(secret),
      binding: copyBinding(binding),
      updatedAt,
    })
  }

  const persistence = (): MqttCredentialPersistence => (!degraded && canSeal() ? 'protected' : 'session')

  return {
    persistence,

    getPresence: (scope) =>
      exclusive(async () => {
        const held = memory.get(scopeKeyOf(scope))
        if (held) return presenceOf(held.secret.method, held.binding, held.updatedAt)
        const stored = await openStored(scope)
        return stored
          ? presenceOf(stored.entry.method, stored.entry.binding, stored.entry.updatedAt)
          : { present: false }
      }),

    put: (scope, secret, binding) =>
      exclusive(async (): Promise<MqttCredentialWriteResult> => {
        const [error] = validateMqttCredentialSecret(secret, binding)
        if (error) {
          audit('put', scope, { result: 'rejected', code: error.code })
          return { ok: false, code: error.code, message: error.message }
        }
        const scopeKey = scopeKeyOf(scope)
        const scopes = await countScopes()
        if (!scopes.has(scopeKey) && scopes.size >= MQTT_CREDENTIAL_VAULT_MAX_ENTRIES) {
          audit('put', scope, { result: 'full' })
          return {
            ok: false,
            code: 'credential_store_unavailable',
            message: 'The local credential store is full. Remove credentials that are no longer used.',
          }
        }
        const updatedAt = now().toISOString()

        if (!degraded && canSeal()) {
          try {
            const sealed = cipher
              .encrypt(JSON.stringify({ scopeKey, binding: copyBinding(binding), secret: copySecret(secret) }))
              .toString('base64')
            const document = await readDocument()
            const entries = document.entries.filter((entry) => scopeKeyOf(entry.scope) !== scopeKey)
            entries.push({
              scope: { ...scope },
              method: secret.method,
              binding: copyBinding(binding),
              updatedAt,
              sealed,
            })
            await writeDocument({ ...document, entries })
            memory.delete(scopeKey)
            audit('put', scope, { result: 'ok', persistence: 'protected', method: secret.method })
            return { ok: true, presence: presenceOf(secret.method, binding, updatedAt) }
          } catch {
            // Never fall back to writing the secret unsealed: keep it in memory for this run instead.
            degraded = true
            audit('put', scope, { result: 'seal_failed' })
          }
        }

        keepInMemory(scope, secret, binding, updatedAt)
        try {
          // A sealed copy left on disk would outlive the replacement the user just made.
          await dropStored(scopeKey)
        } catch {
          audit('discard', scope, { result: 'write_failed' })
        }
        audit('put', scope, { result: 'ok', persistence: 'session', method: secret.method })
        return { ok: true, presence: presenceOf(secret.method, binding, updatedAt) }
      }),

    remove: (scope) =>
      exclusive(async () => {
        const scopeKey = scopeKeyOf(scope)
        const inMemory = memory.delete(scopeKey)
        const onDisk = await dropStored(scopeKey)
        audit('remove', scope, { result: inMemory || onDisk ? 'removed' : 'absent' })
      }),

    readSecret: (scope, binding) =>
      exclusive(async (): Promise<MqttVaultSecretRead> => {
        const held = memory.get(scopeKeyOf(scope))
        const found = held
          ? { binding: held.binding, secret: copySecret(held.secret) }
          : await openStored(scope).then((stored) =>
              stored ? { binding: stored.entry.binding, secret: stored.secret } : null,
            )
        if (!found) {
          audit('read', scope, { result: 'missing' })
          return { ok: false, reason: 'missing' }
        }
        if (!sameBinding(found.binding, binding)) {
          audit('read', scope, { result: 'binding_mismatch' })
          return { ok: false, reason: 'binding_mismatch' }
        }
        audit('read', scope, { result: 'ok' })
        return { ok: true, secret: found.secret }
      }),

    forgetProject: (projectKey) =>
      exclusive(async () => {
        let removed = 0
        for (const [key, entry] of memory) {
          if (entry.scope.projectKey === projectKey) {
            memory.delete(key)
            removed += 1
          }
        }
        const document = await readDocument()
        const kept = document.entries.filter((entry) => entry.scope.projectKey !== projectKey)
        if (kept.length !== document.entries.length) {
          removed += document.entries.length - kept.length
          await writeDocument({ ...document, entries: kept })
        }
        if (removed > 0) audit('forget_project', null, { result: 'removed', count: String(removed) })
        return removed
      }),
  }
}
