import type {
  MqttCredentialBinding,
  MqttCredentialScope,
  MqttCredentialSecret,
} from '../../../../../middleware/shared/ports/mqtt-credential-port'
import { createSessionMqttCredentialStore, mqttCredentialScopeKey, sessionMqttCredentialStore } from '../session-store'
import { MQTT_CREDENTIAL_LIMITS, validateMqttCredentialSecret } from '../validate'

const PASSWORD_MARKER = 'MARKER-PW-e3-7c1f'
const KEY_MARKER = 'MARKER-KEY-e3-2a9d'
const PASSPHRASE_MARKER = 'MARKER-PASS-e3-5b0e'

const CERT = '-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIU\n-----END CERTIFICATE-----\n'
const KEY = `-----BEGIN PRIVATE KEY-----\n${KEY_MARKER}\n-----END PRIVATE KEY-----\n`

const passwordBinding: MqttCredentialBinding = {
  host: 'broker.plant.local',
  port: 8883,
  tlsEnabled: true,
  clientId: 'plc-1',
  method: 'username_password',
}
const certificateBinding: MqttCredentialBinding = { ...passwordBinding, method: 'client_certificate' }

const passwordSecret: MqttCredentialSecret = { method: 'username_password', username: 'plc', password: PASSWORD_MARKER }
const certificateSecret: MqttCredentialSecret = {
  method: 'client_certificate',
  certificatePem: CERT,
  privateKeyPem: KEY,
  privateKeyPassphrase: PASSPHRASE_MARKER,
}

const scope = (overrides: Partial<MqttCredentialScope> = {}): MqttCredentialScope => ({
  projectKey: '/projects/a',
  targetKey: 'address:192.168.1.50',
  serverName: 'MQTT',
  ...overrides,
})

describe('validateMqttCredentialSecret', () => {
  it('accepts a username and password and a certificate with its key', () => {
    expect(validateMqttCredentialSecret(passwordSecret, passwordBinding)).toEqual([])
    expect(validateMqttCredentialSecret(certificateSecret, certificateBinding)).toEqual([])
    for (const header of ['RSA PRIVATE KEY', 'EC PRIVATE KEY', 'ENCRYPTED PRIVATE KEY']) {
      const key = `-----BEGIN ${header}-----\nAAAA\n-----END ${header}-----`
      expect(validateMqttCredentialSecret({ ...certificateSecret, privateKeyPem: key }, certificateBinding)).toEqual([])
    }
  })

  it('refuses a secret for another method before looking at it', () => {
    expect(validateMqttCredentialSecret(passwordSecret, certificateBinding).map((e) => e.code)).toEqual([
      'credential_method_mismatch',
    ])
  })

  it.each<[string, MqttCredentialSecret, string, string]>([
    ['empty username', { ...passwordSecret, username: '' }, 'username', 'credential_invalid_format'],
    ['control character', { ...passwordSecret, username: 'a\nb' }, 'username', 'credential_invalid_format'],
    ['DEL character', { ...passwordSecret, username: 'a\u007fb' }, 'username', 'credential_invalid_format'],
    ['long username', { ...passwordSecret, username: 'é'.repeat(129) }, 'username', 'credential_too_large'],
    ['empty password', { ...passwordSecret, password: '' }, 'password', 'credential_invalid_format'],
    ['long password', { ...passwordSecret, password: 'x'.repeat(1025) }, 'password', 'credential_too_large'],
  ])('flags %s', (_label, secret, field, code) => {
    expect(validateMqttCredentialSecret(secret, passwordBinding)).toEqual([expect.objectContaining({ field, code })])
  })

  it('accepts usernames and passwords exactly at the byte limits', () => {
    const secret: MqttCredentialSecret = {
      method: 'username_password',
      username: 'é'.repeat(MQTT_CREDENTIAL_LIMITS.maxUsernameBytes / 2),
      password: 'x'.repeat(MQTT_CREDENTIAL_LIMITS.maxPasswordBytes),
    }
    expect(validateMqttCredentialSecret(secret, passwordBinding)).toEqual([])
  })

  it.each<[string, Partial<Extract<MqttCredentialSecret, { method: 'client_certificate' }>>, string, string]>([
    ['certificate not PEM', { certificatePem: 'MIIB' }, 'certificatePem', 'credential_invalid_format'],
    ['key in certificate field', { certificatePem: KEY }, 'certificatePem', 'credential_invalid_format'],
    ['certificate too large', { certificatePem: 'x'.repeat(65537) }, 'certificatePem', 'credential_too_large'],
    ['certificate in key field', { privateKeyPem: CERT }, 'privateKeyPem', 'credential_invalid_format'],
    [
      'mismatched key markers',
      { privateKeyPem: '-----BEGIN RSA PRIVATE KEY-----\nA\n-----END PRIVATE KEY-----' },
      'privateKeyPem',
      'credential_invalid_format',
    ],
    ['key too large', { privateKeyPem: 'x'.repeat(65537) }, 'privateKeyPem', 'credential_too_large'],
    [
      'passphrase too large',
      { privateKeyPassphrase: 'x'.repeat(1025) },
      'privateKeyPassphrase',
      'credential_too_large',
    ],
  ])('flags %s', (_label, patch, field, code) => {
    expect(validateMqttCredentialSecret({ ...certificateSecret, ...patch }, certificateBinding)).toEqual([
      expect.objectContaining({ field, code }),
    ])
  })

  it('never echoes the secret in a message', () => {
    const errors = [
      ...validateMqttCredentialSecret({ ...passwordSecret, username: `${PASSWORD_MARKER}\n` }, passwordBinding),
      ...validateMqttCredentialSecret(
        { ...certificateSecret, certificatePem: KEY, privateKeyPem: `${KEY_MARKER}` },
        certificateBinding,
      ),
    ]
    expect(errors.length).toBeGreaterThan(0)
    expect(JSON.stringify(errors)).not.toMatch(/MARKER-/)
  })
})

describe('session credential store', () => {
  const fixedNow = () => new Date('2026-10-12T10:00:00.000Z')

  it('reports presence and non-secret metadata only, never the secret', async () => {
    const store = createSessionMqttCredentialStore(fixedNow)
    expect(store.persistence).toBe('session')
    expect(await store.getPresence(scope())).toEqual({ present: false })

    const written = await store.put(scope(), passwordSecret, passwordBinding)
    expect(written).toEqual({
      ok: true,
      presence: {
        present: true,
        method: 'username_password',
        binding: passwordBinding,
        usernameSet: true,
        updatedAt: '2026-10-12T10:00:00.000Z',
      },
    })
    const presence = await store.getPresence(scope())
    expect(JSON.stringify(presence)).not.toContain(PASSWORD_MARKER)
    expect(JSON.stringify(presence)).not.toContain('plc"')
    expect(Object.keys(store).sort()).toEqual(['getPresence', 'persistence', 'put', 'remove'])
  })

  it('keeps certificate credentials apart per project, target and server', async () => {
    const store = createSessionMqttCredentialStore(fixedNow)
    await store.put(scope(), certificateSecret, certificateBinding)
    const presence = await store.getPresence(scope())
    expect(presence).toEqual({
      present: true,
      method: 'client_certificate',
      binding: certificateBinding,
      updatedAt: '2026-10-12T10:00:00.000Z',
    })
    expect(JSON.stringify(presence)).not.toMatch(/MARKER-/)
    expect((await store.getPresence(scope({ projectKey: '/projects/b' }))).present).toBe(false)
    expect((await store.getPresence(scope({ targetKey: 'address:10.0.0.9' }))).present).toBe(false)
    expect((await store.getPresence(scope({ serverName: 'MQTT2' }))).present).toBe(false)
  })

  it('refuses invalid input without storing anything', async () => {
    const store = createSessionMqttCredentialStore(fixedNow)
    const result = await store.put(scope(), { ...passwordSecret, password: '' }, passwordBinding)
    expect(result).toEqual({ ok: false, code: 'credential_invalid_format', message: 'Enter a password.' })
    expect((await store.getPresence(scope())).present).toBe(false)
  })

  it('replaces and removes a credential', async () => {
    const store = createSessionMqttCredentialStore(fixedNow)
    await store.put(scope(), passwordSecret, passwordBinding)
    const moved = { ...passwordBinding, host: 'other.broker' }
    await store.put(scope(), { ...passwordSecret, password: 'second' }, moved)
    expect((await store.getPresence(scope())).binding).toEqual(moved)
    await store.remove(scope())
    expect(await store.getPresence(scope())).toEqual({ present: false })
  })

  it('copies the input, so later changes to the caller objects do not leak in', async () => {
    const store = createSessionMqttCredentialStore(fixedNow)
    const binding = { ...passwordBinding }
    await store.put(scope(), passwordSecret, binding)
    binding.host = 'mutated'
    expect((await store.getPresence(scope())).binding?.host).toBe('broker.plant.local')
  })

  it('stores a certificate without a passphrase and exposes a process-wide session store', async () => {
    const store = createSessionMqttCredentialStore()
    const { privateKeyPassphrase: _unused, ...withoutPassphrase } = certificateSecret
    expect((await store.put(scope(), withoutPassphrase, certificateBinding)).ok).toBe(true)
    expect(sessionMqttCredentialStore.persistence).toBe('session')
    expect(mqttCredentialScopeKey(scope())).toBe('["/projects/a","address:192.168.1.50","MQTT"]')
  })
})
