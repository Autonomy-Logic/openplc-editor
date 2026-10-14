/**
 * The MQTT credential vault with a real AES cipher standing in for the OS keychain and an in-memory file.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

import type {
  MqttCredentialBinding,
  MqttCredentialScope,
  MqttCredentialSecret,
} from '../../../../middleware/shared/ports/mqtt-credential-port'
import {
  createMqttCredentialVault,
  MQTT_CREDENTIAL_VAULT_MAX_ENTRIES,
  mqttCredentialEntryLabel,
  type MqttVaultCipher,
  type MqttVaultStorage,
} from '../vault'

const PASSWORD = 'MARKER-PW-e4-vault-7c1d'
const USERNAME = 'MARKER-USER-e4-vault-0b9e'
const KEY_BODY = 'MARKERKEYBODYe4vault5a2f'
const PASSPHRASE = 'MARKER-PASS-e4-vault-93aa'
const MARKERS = [PASSWORD, USERNAME, KEY_BODY, PASSPHRASE]

const CERTIFICATE = '-----BEGIN CERTIFICATE-----\nMIIBcertificatebody\n-----END CERTIFICATE-----\n'
const PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----\n${KEY_BODY}\n-----END PRIVATE KEY-----\n`

const SCOPE: MqttCredentialScope = {
  projectKey: '/home/ada/projects/line-1',
  targetKey: 'address:192.168.1.50',
  serverName: 'Telemetry',
}
const OTHER_TARGET: MqttCredentialScope = { ...SCOPE, targetKey: 'address:192.168.1.51' }
const OTHER_PROJECT: MqttCredentialScope = { ...SCOPE, projectKey: '/home/ada/projects/line-2' }
const OTHER_SERVER: MqttCredentialScope = { ...SCOPE, serverName: 'Second' }

const BINDING: MqttCredentialBinding = {
  host: 'broker.plant.local',
  port: 8883,
  tlsEnabled: true,
  clientId: 'line-1',
  method: 'username_password',
}
const CERT_BINDING: MqttCredentialBinding = { ...BINDING, method: 'client_certificate' }

const PASSWORD_SECRET: MqttCredentialSecret = { method: 'username_password', username: USERNAME, password: PASSWORD }
const CERT_SECRET: MqttCredentialSecret = {
  method: 'client_certificate',
  certificatePem: CERTIFICATE,
  privateKeyPem: PRIVATE_KEY,
  privateKeyPassphrase: PASSPHRASE,
}

interface TestCipher extends MqttVaultCipher {
  available: boolean
  failEncrypt: boolean
}

/** AES-256-GCM with a per-instance key: a new instance is "another OS user" or a reset keychain. */
const createTestCipher = (key: string = randomBytes(32).toString('hex')): TestCipher => {
  const keyBytes = Uint8Array.from(Buffer.from(key, 'hex'))
  const cipher: TestCipher = {
    available: true,
    failEncrypt: false,
    canEncrypt: () => cipher.available,
    encrypt: (plain) => {
      if (cipher.failEncrypt) throw new Error('keychain refused')
      const iv = randomBytes(12).toString('hex')
      const aes = createCipheriv('aes-256-gcm', keyBytes, Uint8Array.from(Buffer.from(iv, 'hex')))
      const body = aes.update(plain, 'utf-8', 'hex') + aes.final('hex')
      return Buffer.from(iv + aes.getAuthTag().toString('hex') + body, 'hex')
    },
    decrypt: (sealed) => {
      const hex = sealed.toString('hex')
      const aes = createDecipheriv('aes-256-gcm', keyBytes, Uint8Array.from(Buffer.from(hex.slice(0, 24), 'hex')))
      aes.setAuthTag(Uint8Array.from(Buffer.from(hex.slice(24, 56), 'hex')))
      return aes.update(hex.slice(56), 'hex', 'utf-8') + aes.final('utf-8')
    },
  }
  return cipher
}

interface TestStorage extends MqttVaultStorage {
  content: string | null
  failRead: boolean
  failWrite: boolean
  writes: number
}

const createTestStorage = (): TestStorage => {
  const storage: TestStorage = {
    content: null,
    failRead: false,
    failWrite: false,
    writes: 0,
    read: () => (storage.failRead ? Promise.reject(new Error('EACCES')) : Promise.resolve(storage.content)),
    write: (content) => {
      if (storage.failWrite) return Promise.reject(new Error('ENOSPC'))
      storage.writes += 1
      storage.content = content
      return Promise.resolve()
    },
  }
  return storage
}

interface StoredDocument {
  entries: Array<{ scope: MqttCredentialScope; binding: MqttCredentialBinding; sealed: string; method: string }>
}

const documentOf = (storage: TestStorage): StoredDocument => {
  const parsed: StoredDocument = JSON.parse(storage.content ?? '{"entries":[]}')
  return parsed
}

const expectNoMarker = (text: string) => {
  for (const marker of MARKERS) {
    expect(text).not.toContain(marker)
    expect(text).not.toContain(Buffer.from(marker).toString('base64'))
  }
}

const setup = (cipher = createTestCipher(), storage = createTestStorage()) => {
  const lines: string[] = []
  let clock = Date.parse('2026-10-12T10:00:00.000Z')
  const vault = createMqttCredentialVault({
    cipher,
    storage,
    log: (level, line) => lines.push(`${level} ${line}`),
    now: () => new Date((clock += 1000)),
  })
  return { vault, cipher, storage, lines }
}

describe('protected persistence', () => {
  it('seals the secret outside the clear metadata and reports presence only', async () => {
    const { vault, storage } = setup()

    expect(vault.persistence()).toBe('protected')
    const result = await vault.put(SCOPE, PASSWORD_SECRET, BINDING)

    expect(result).toEqual({
      ok: true,
      presence: {
        present: true,
        method: 'username_password',
        binding: BINDING,
        usernameSet: true,
        updatedAt: '2026-10-12T10:00:01.000Z',
      },
    })
    expectNoMarker(JSON.stringify(result))
    expectNoMarker(storage.content ?? '')
    const [entry] = documentOf(storage).entries
    expect(entry).toMatchObject({ scope: SCOPE, binding: BINDING, method: 'username_password' })
    expect(await vault.getPresence(SCOPE)).toMatchObject({ present: true, binding: BINDING })
    expectNoMarker(JSON.stringify(await vault.getPresence(SCOPE)))
  })

  it('survives a restart that has the same keychain', async () => {
    const cipher = createTestCipher()
    const storage = createTestStorage()
    await setup(cipher, storage).vault.put(SCOPE, CERT_SECRET, CERT_BINDING)

    const restarted = setup(cipher, storage).vault
    expect(await restarted.getPresence(SCOPE)).toMatchObject({ present: true, method: 'client_certificate' })
    expect(await restarted.getPresence(SCOPE)).not.toHaveProperty('usernameSet')
    expect(await restarted.readSecret(SCOPE, CERT_BINDING)).toEqual({ ok: true, secret: CERT_SECRET })
  })

  it('keeps entries apart by project, target and server', async () => {
    const { vault } = setup()
    await vault.put(SCOPE, PASSWORD_SECRET, BINDING)

    for (const other of [OTHER_TARGET, OTHER_PROJECT, OTHER_SERVER]) {
      expect(await vault.getPresence(other)).toEqual({ present: false })
      expect(await vault.readSecret(other, BINDING)).toEqual({ ok: false, reason: 'missing' })
    }
  })

  it('hands the secret to main-process callers only for the binding it was entered for', async () => {
    const { vault } = setup()
    await vault.put(SCOPE, PASSWORD_SECRET, BINDING)

    expect(await vault.readSecret(SCOPE, BINDING)).toEqual({ ok: true, secret: PASSWORD_SECRET })
    for (const changed of [
      { ...BINDING, host: 'rogue.example' },
      { ...BINDING, port: 8884 },
      { ...BINDING, tlsEnabled: false },
      { ...BINDING, clientId: 'other' },
      CERT_BINDING,
    ]) {
      expect(await vault.readSecret(SCOPE, changed)).toEqual({ ok: false, reason: 'binding_mismatch' })
    }
  })

  it('returns copies, so a caller cannot change what is stored', async () => {
    const { vault } = setup()
    const secret = { method: 'username_password' as const, username: USERNAME, password: PASSWORD }
    await vault.put(SCOPE, secret, BINDING)
    secret.password = 'changed-after-put'

    const read = await vault.readSecret(SCOPE, BINDING)
    expect(read).toEqual({ ok: true, secret: PASSWORD_SECRET })
  })

  it('drops an entry sealed under another keychain instead of retrying it', async () => {
    const storage = createTestStorage()
    await setup(createTestCipher(), storage).vault.put(SCOPE, PASSWORD_SECRET, BINDING)

    const { vault, lines } = setup(createTestCipher(), storage)
    expect(await vault.getPresence(SCOPE)).toEqual({ present: false })
    expect(documentOf(storage).entries).toHaveLength(0)
    expect(lines.join('\n')).toContain('event=discard result=unreadable')
  })

  it('refuses a sealed blob moved onto another entry or whose clear binding was edited', async () => {
    const { vault, storage } = setup()
    await vault.put(SCOPE, PASSWORD_SECRET, BINDING)
    await vault.put(OTHER_SERVER, { ...PASSWORD_SECRET, password: 'second-password' }, BINDING)

    const document = documentOf(storage)
    const [first, second] = document.entries
    storage.content = JSON.stringify({
      format: 'openplc-editor-mqtt-credentials',
      version: 1,
      entries: [
        { ...first, sealed: second.sealed },
        { ...second, binding: { ...second.binding, host: 'rogue.example' } },
      ],
    })

    expect(await vault.readSecret(SCOPE, BINDING)).toEqual({ ok: false, reason: 'missing' })
    expect(await vault.readSecret(OTHER_SERVER, { ...BINDING, host: 'rogue.example' })).toEqual({
      ok: false,
      reason: 'missing',
    })
    expect(documentOf(storage).entries).toHaveLength(0)
  })

  it('replaces the stored credential in place', async () => {
    const { vault, storage } = setup()
    await vault.put(SCOPE, PASSWORD_SECRET, BINDING)
    const replaced = await vault.put(SCOPE, CERT_SECRET, CERT_BINDING)

    expect(replaced).toMatchObject({ ok: true, presence: { method: 'client_certificate' } })
    expect(documentOf(storage).entries).toHaveLength(1)
    expect(await vault.readSecret(SCOPE, BINDING)).toEqual({ ok: false, reason: 'binding_mismatch' })
    expect(await vault.readSecret(SCOPE, CERT_BINDING)).toEqual({ ok: true, secret: CERT_SECRET })
  })

  it('removes the credential from disk', async () => {
    const { vault, storage, lines } = setup()
    await vault.put(SCOPE, PASSWORD_SECRET, BINDING)
    await vault.put(OTHER_SERVER, PASSWORD_SECRET, BINDING)

    await vault.remove(SCOPE)

    expect(await vault.getPresence(SCOPE)).toEqual({ present: false })
    expect(await vault.readSecret(SCOPE, BINDING)).toEqual({ ok: false, reason: 'missing' })
    expect(documentOf(storage).entries.map((entry) => entry.scope.serverName)).toEqual(['Second'])
    await vault.remove(SCOPE)
    expect(lines.filter((line) => line.includes('event=remove'))).toEqual([
      `info MQTT credential store: event=remove result=removed entry=${mqttCredentialEntryLabel(SCOPE)}`,
      `info MQTT credential store: event=remove result=absent entry=${mqttCredentialEntryLabel(SCOPE)}`,
    ])
  })

  it('omits an empty passphrase', async () => {
    const { vault } = setup()
    const withoutPassphrase: MqttCredentialSecret = {
      method: 'client_certificate',
      certificatePem: CERTIFICATE,
      privateKeyPem: PRIVATE_KEY,
    }
    await vault.put(SCOPE, withoutPassphrase, CERT_BINDING)
    expect(await vault.readSecret(SCOPE, CERT_BINDING)).toEqual({ ok: true, secret: withoutPassphrase })
  })

  it('serialises concurrent writes so none is lost', async () => {
    const { vault, storage } = setup()
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        vault.put({ ...SCOPE, serverName: `S${index}` }, PASSWORD_SECRET, BINDING),
      ),
    )
    expect(documentOf(storage).entries).toHaveLength(8)
  })
})

describe('without OS encryption', () => {
  it('keeps the secret in memory only and forgets it on restart', async () => {
    const cipher = createTestCipher()
    cipher.available = false
    const { vault, storage } = setup(cipher)

    expect(vault.persistence()).toBe('session')
    expect(await vault.put(SCOPE, PASSWORD_SECRET, BINDING)).toMatchObject({ ok: true })
    expect(storage.content).toBeNull()
    expect(await vault.getPresence(SCOPE)).toMatchObject({ present: true })
    expect(await vault.readSecret(SCOPE, BINDING)).toEqual({ ok: true, secret: PASSWORD_SECRET })

    const restarted = setup(cipher, storage).vault
    expect(await restarted.getPresence(SCOPE)).toEqual({ present: false })
  })

  it('leaves an entry sealed in an earlier run alone until encryption is back', async () => {
    const cipher = createTestCipher()
    const storage = createTestStorage()
    await setup(cipher, storage).vault.put(SCOPE, PASSWORD_SECRET, BINDING)

    cipher.available = false
    const locked = setup(cipher, storage).vault
    expect(await locked.getPresence(SCOPE)).toEqual({ present: false })
    expect(documentOf(storage).entries).toHaveLength(1)

    cipher.available = true
    expect(await locked.getPresence(SCOPE)).toMatchObject({ present: true })
  })

  it('drops the sealed copy of a credential replaced in memory', async () => {
    const cipher = createTestCipher()
    const storage = createTestStorage()
    await setup(cipher, storage).vault.put(SCOPE, PASSWORD_SECRET, BINDING)

    cipher.available = false
    const { vault } = setup(cipher, storage)
    await vault.put(SCOPE, { ...PASSWORD_SECRET, password: 'replacement' }, BINDING)

    expect(documentOf(storage).entries).toHaveLength(0)
    expect(await vault.readSecret(SCOPE, BINDING)).toEqual({
      ok: true,
      secret: { ...PASSWORD_SECRET, password: 'replacement' },
    })
  })

  it('falls back to memory, never to clear text, when sealing fails', async () => {
    const cipher = createTestCipher()
    cipher.failEncrypt = true
    const { vault, storage, lines } = setup(cipher)

    expect(await vault.put(SCOPE, PASSWORD_SECRET, BINDING)).toMatchObject({ ok: true })
    expect(storage.content).toBeNull()
    expect(vault.persistence()).toBe('session')
    expect(lines.join('\n')).toContain('event=put result=seal_failed')
    expect(await vault.readSecret(SCOPE, BINDING)).toMatchObject({ ok: true })
  })

  it('falls back to memory when the vault file cannot be written', async () => {
    const storage = createTestStorage()
    storage.failWrite = true
    const { vault } = setup(createTestCipher(), storage)

    expect(await vault.put(SCOPE, PASSWORD_SECRET, BINDING)).toMatchObject({ ok: true })
    expect(vault.persistence()).toBe('session')
    expect(await vault.getPresence(SCOPE)).toMatchObject({ present: true })
  })
})

describe('input and limits', () => {
  it('refuses a malformed secret without storing or echoing it', async () => {
    const { vault, storage } = setup()

    const mismatch = await vault.put(SCOPE, PASSWORD_SECRET, CERT_BINDING)
    expect(mismatch).toMatchObject({ ok: false, code: 'credential_method_mismatch' })
    const empty = await vault.put(SCOPE, { method: 'username_password', username: USERNAME, password: '' }, BINDING)
    expect(empty).toMatchObject({ ok: false, code: 'credential_invalid_format' })
    const oversized = await vault.put(
      SCOPE,
      { method: 'username_password', username: USERNAME, password: PASSWORD.repeat(100) },
      BINDING,
    )
    expect(oversized).toMatchObject({ ok: false, code: 'credential_too_large' })

    expectNoMarker(JSON.stringify([mismatch, empty, oversized]))
    expect(storage.content).toBeNull()
  })

  it(`holds at most ${MQTT_CREDENTIAL_VAULT_MAX_ENTRIES} entries but still lets one be replaced`, async () => {
    const { vault } = setup()
    for (let index = 0; index < MQTT_CREDENTIAL_VAULT_MAX_ENTRIES; index += 1) {
      await vault.put({ ...SCOPE, serverName: `S${index}` }, PASSWORD_SECRET, BINDING)
    }

    expect(await vault.put({ ...SCOPE, serverName: 'one-more' }, PASSWORD_SECRET, BINDING)).toMatchObject({
      ok: false,
      code: 'credential_store_unavailable',
    })
    expect(await vault.put({ ...SCOPE, serverName: 'S0' }, PASSWORD_SECRET, BINDING)).toMatchObject({ ok: true })
  })

  it('treats a corrupt or unreadable vault file as empty and rewrites it on the next save', async () => {
    const { vault, storage, lines } = setup()
    storage.content = '{"format":"something-else"'

    expect(await vault.getPresence(SCOPE)).toEqual({ present: false })
    expect(await vault.put(SCOPE, PASSWORD_SECRET, BINDING)).toMatchObject({ ok: true })
    expect(documentOf(storage).entries).toHaveLength(1)

    storage.failRead = true
    expect(await vault.getPresence(OTHER_SERVER)).toEqual({ present: false })
    expect(lines.join('\n')).toContain('event=read result=corrupt')
    expect(lines.join('\n')).toContain('event=read result=unreadable')
  })
})

describe('cleanup and audit lines', () => {
  it('forgets every credential of a deleted project, in memory and on disk', async () => {
    const cipher = createTestCipher()
    const storage = createTestStorage()
    const { vault } = setup(cipher, storage)
    await vault.put(SCOPE, PASSWORD_SECRET, BINDING)
    await vault.put(OTHER_SERVER, PASSWORD_SECRET, BINDING)
    await vault.put(OTHER_PROJECT, PASSWORD_SECRET, BINDING)
    cipher.available = false
    await vault.put(OTHER_TARGET, PASSWORD_SECRET, BINDING)
    cipher.available = true

    expect(await vault.forgetProject(SCOPE.projectKey)).toBe(3)
    expect(await vault.forgetProject(SCOPE.projectKey)).toBe(0)
    expect(await vault.getPresence(OTHER_TARGET)).toEqual({ present: false })
    expect(documentOf(storage).entries.map((entry) => entry.scope.projectKey)).toEqual([OTHER_PROJECT.projectKey])
  })

  it('logs events without secrets, paths, targets or broker names', async () => {
    const { vault, lines } = setup()
    await vault.put(SCOPE, CERT_SECRET, CERT_BINDING)
    await vault.getPresence(SCOPE)
    await vault.readSecret(SCOPE, CERT_BINDING)
    await vault.readSecret(SCOPE, BINDING)
    await vault.put(SCOPE, PASSWORD_SECRET, CERT_BINDING)
    await vault.remove(SCOPE)
    await vault.forgetProject(SCOPE.projectKey)

    const text = lines.join('\n')
    expectNoMarker(text)
    for (const identifying of [SCOPE.projectKey, SCOPE.targetKey, BINDING.host, BINDING.clientId]) {
      expect(text).not.toContain(identifying)
    }
    expect(text).toContain(`event=put result=ok persistence=protected method=client_certificate entry=`)
    expect(text).toContain('event=read result=binding_mismatch')
    expect(text).toContain('event=put result=rejected code=credential_method_mismatch')
  })
})
