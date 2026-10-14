/** @jest-environment node */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { MqttProjectIntegrationV1 } from '../../../../frontend/utils/mqtt/contract/contract'
import { createDefaultMqttIntegration } from '../../../../frontend/utils/mqtt/project/model'
import type { MqttCredentialSecret } from '../../../../middleware/shared/ports/mqtt-credential-port'
import { createMqttCredentialVault, type MqttVaultCipher, type MqttVaultStorage } from '../../mqtt-credentials/vault'
import { RuntimeIdentityError } from '../../runtime/pinned-runtime-request'
import {
  buildStagingBody,
  createMqttCredentialDeployer,
  MQTT_STAGING_PATH,
  type RuntimeApiCall,
} from '../credential-deployer'

const API = join(__dirname, '..', '..', '..', '..', 'frontend', 'utils', 'mqtt', 'contract', 'fixtures', 'api')
const fixture = (file: string): Record<string, unknown> => JSON.parse(readFileSync(join(API, file), 'utf-8'))

const PASSWORD = 'MARKER-PW-e5-deploy-2b8e'
const USERNAME = 'MARKER-USER-e5-deploy-c41a'
const KEY_BODY = 'MARKERKEYBODYe5deploy7d3f'
const PASSPHRASE = 'MARKER-PASS-e5-deploy-0a9c'
const MARKERS = [PASSWORD, USERNAME, KEY_BODY, PASSPHRASE]
const PIN = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
const ADDRESS = '192.168.10.20'
const PROJECT = '/home/ada/projects/line-1'
const PROGRAM_MD5 = '3f2c9d0e8b7a6f5e4d3c2b1a09f8e7d6'

const integration = (method: 'username_password' | 'client_certificate'): MqttProjectIntegrationV1 => {
  const base = createDefaultMqttIntegration('plc-linha1')
  return {
    ...base,
    enabled: true,
    authMethod: method,
    connection: { ...base.connection, host: 'broker.example.net', port: 8883 },
  }
}

const bindingOf = (method: 'username_password' | 'client_certificate') => ({
  host: 'broker.example.net',
  port: 8883,
  tlsEnabled: true,
  clientId: 'plc-linha1',
  method,
})

const scope = { projectKey: PROJECT, targetKey: `address:${ADDRESS}`, serverName: 'broker' }

const aesCipher = (): MqttVaultCipher => {
  const key = Uint8Array.from(randomBytes(32))
  return {
    canEncrypt: () => true,
    encrypt: (plain) => {
      const iv = Uint8Array.from(randomBytes(12))
      const aes = createCipheriv('aes-256-gcm', key, iv)
      const body = Buffer.concat([aes.update(plain, 'utf-8'), aes.final()].map((b) => Uint8Array.from(b)))
      return Buffer.concat([iv, Uint8Array.from(aes.getAuthTag()), Uint8Array.from(body)])
    },
    decrypt: (sealed) => {
      const aes = createDecipheriv('aes-256-gcm', key, Uint8Array.from(sealed.subarray(0, 12)))
      aes.setAuthTag(Uint8Array.from(sealed.subarray(12, 28)))
      return aes.update(Uint8Array.from(sealed.subarray(28)), undefined, 'utf-8') + aes.final('utf-8')
    },
  }
}

const memoryStorage = (): MqttVaultStorage & { content: string | null } => {
  const storage = {
    content: null as string | null,
    read: () => Promise.resolve(storage.content),
    write: (content: string) => {
      storage.content = content
      return Promise.resolve()
    },
  }
  return storage
}

const PASSWORD_SECRET: MqttCredentialSecret = { method: 'username_password', username: USERNAME, password: PASSWORD }
const CERT_SECRET: MqttCredentialSecret = {
  method: 'client_certificate',
  certificatePem: '-----BEGIN CERTIFICATE-----\nMIIBcert\n-----END CERTIFICATE-----\n',
  privateKeyPem: `-----BEGIN PRIVATE KEY-----\n${KEY_BODY}\n-----END PRIVATE KEY-----\n`,
  privateKeyPassphrase: PASSPHRASE,
}

const receipt = (method: 'username_password' | 'client_certificate', overrides: Record<string, unknown> = {}) => {
  const base = fixture('staging-receipt.json')
  const binding = { ...(base.binding as Record<string, unknown>), method }
  const withMethod: Record<string, unknown> = { ...base, method, binding, programMd5: PROGRAM_MD5, ...overrides }
  if (method === 'username_password') delete withMethod.clientCertificate
  return withMethod
}

interface Reply {
  status: number
  body: unknown
}

interface Harness {
  calls: Array<RuntimeApiCall & { address: string; sha256: string; bodyText: string }>
  bodies: Buffer[]
  lines: string[]
}

const setup = async (options: {
  secret?: MqttCredentialSecret | null
  storedBinding?: ReturnType<typeof bindingOf>
  pinned?: boolean
  session?: string | null
  replies?: Record<string, Reply | Error>
}) => {
  const vault = createMqttCredentialVault({ cipher: aesCipher(), storage: memoryStorage(), log: () => undefined })
  const secret = options.secret === undefined ? PASSWORD_SECRET : options.secret
  if (secret) await vault.put(scope, secret, options.storedBinding ?? bindingOf(secret.method))
  const harness: Harness = { calls: [], bodies: [], lines: [] }
  const replies: Record<string, Reply | Error> = {
    'GET /api/mqtt/capabilities': { status: 200, body: fixture('capabilities.json') },
    [`POST ${MQTT_STAGING_PATH}`]: { status: 201, body: receipt(secret?.method ?? 'username_password') },
    'GET /api/mqtt/credentials': { status: 200, body: { active: null, staged: [] } },
    ...options.replies,
  }
  const deployer = createMqttCredentialDeployer({
    vault,
    identity: { get: () => Promise.resolve(options.pinned === false ? null : { sha256: PIN, updatedAt: 'now' }) },
    sessionAddress: () => (options.session === undefined ? ADDRESS : options.session),
    request: (address, sha256, call) => {
      if (call.body) harness.bodies.push(call.body)
      harness.calls.push({ ...call, address, sha256, bodyText: call.body ? call.body.toString('utf-8') : '' })
      const key = `${call.method} ${call.path.startsWith(`${MQTT_STAGING_PATH}/`) ? `${MQTT_STAGING_PATH}/:id` : call.path}`
      const reply = replies[key] ?? { status: 204, body: '' }
      if (reply instanceof Error) return Promise.reject(reply)
      return Promise.resolve({
        statusCode: reply.status,
        body: typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body),
      })
    },
    log: (_level, line) => harness.lines.push(line),
  })
  return { deployer, harness }
}

const stageInput = (method: 'username_password' | 'client_certificate' = 'username_password') => ({
  address: ADDRESS,
  projectKey: PROJECT,
  serverName: 'broker',
  integration: integration(method),
  programMd5: PROGRAM_MD5,
})

/** Multipart parts of a staging body, by name. */
const parts = (text: string): Record<string, string> => {
  const boundary = text.slice(2, text.indexOf('\r\n'))
  const result: Record<string, string> = {}
  for (const chunk of text.split(`--${boundary}`).slice(1, -1)) {
    const [head, ...rest] = chunk.replace(/^\r\n/, '').split('\r\n\r\n')
    const name = /name="([^"]+)"/.exec(head)?.[1] ?? ''
    result[name] = rest.join('\r\n\r\n').replace(/\r\n$/, '')
  }
  return result
}

const expectNoMarkers = (harness: Harness) => {
  for (const line of harness.lines) for (const marker of MARKERS) expect(line).not.toContain(marker)
  for (const line of harness.lines) expect(line).not.toContain('broker.example.net')
}

describe('MQTT credential deployer', () => {
  it('stages the password from the vault on the pinned runtime and returns only the reference', async () => {
    const { deployer, harness } = await setup({})
    const result = await deployer.stage(stageInput())
    const expected = receipt('username_password')
    expect(result).toEqual({
      ok: true,
      credentialRef: { id: '6f1c2a4e-8d3b-4c5a-9e7f-0a1b2c3d4e5f', revision: 4, staging_id: expected.stagingId },
      stagingId: expected.stagingId,
    })
    expect(harness.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /api/mqtt/capabilities',
      `POST ${MQTT_STAGING_PATH}`,
    ])
    expect(harness.calls.every((c) => c.address === ADDRESS && c.sha256 === PIN)).toBe(true)
    const staging = harness.calls[1]
    expect(staging.headers?.['Content-Type']).toMatch(/^multipart\/form-data; boundary=----openplc-mqtt-[0-9a-f]{32}$/)
    const sent = parts(staging.bodyText)
    expect(Object.keys(sent)).toEqual(['request', 'password'])
    expect(sent.password).toBe(PASSWORD)
    expect(Object.keys(JSON.parse(sent.request)).sort()).toEqual(
      Object.keys(fixture('staging-request-password.json')).sort(),
    )
    expect(JSON.parse(sent.request)).toEqual({
      method: 'username_password',
      binding: {
        host: 'broker.example.net',
        port: 8883,
        tls_enabled: true,
        client_id: 'plc-linha1',
        method: 'username_password',
      },
      programMd5: PROGRAM_MD5,
      username: USERNAME,
    })
    expect(harness.bodies[0].every((byte) => byte === 0)).toBe(true)
    expect(JSON.stringify(result)).not.toContain(PASSWORD)
    expectNoMarkers(harness)
    expect(harness.lines.at(-1)).toMatch(
      /event=stage result=staged method=username_password entry=[0-9a-f]{12} credential=/,
    )
  })

  it('sends a client certificate, key and passphrase as their own parts', async () => {
    const { deployer, harness } = await setup({ secret: CERT_SECRET })
    const result = await deployer.stage(stageInput('client_certificate'))
    expect(result.ok).toBe(true)
    const sent = parts(harness.calls[1].bodyText)
    expect(Object.keys(sent)).toEqual(['request', 'client_certificate', 'client_key', 'client_key_passphrase'])
    expect(sent.client_key).toContain(KEY_BODY)
    expect(sent.client_key_passphrase).toBe(PASSPHRASE)
    expect(JSON.parse(sent.request)).not.toHaveProperty('username')
    expectNoMarkers(harness)
  })

  it('builds a body the runtime part rules accept: no username outside the password method', () => {
    const { body } = buildStagingBody(
      bindingOf('client_certificate'),
      { ...CERT_SECRET, privateKeyPassphrase: undefined },
      PROGRAM_MD5,
    )
    expect(Object.keys(parts(body.toString('utf-8')))).toEqual(['request', 'client_certificate', 'client_key'])
  })

  it('refuses to contact a runtime whose identity was never pinned', async () => {
    const { deployer, harness } = await setup({ pinned: false })
    expect(await deployer.stage(stageInput())).toMatchObject({ ok: false, code: 'runtime_trust_missing' })
    expect(harness.calls).toEqual([])
  })

  it('refuses a target other than the one the session logged in to', async () => {
    const { deployer, harness } = await setup({ session: '192.168.10.99' })
    expect(await deployer.stage(stageInput())).toMatchObject({ ok: false, code: 'forbidden' })
    const loggedOut = await setup({ session: null })
    expect(await loggedOut.deployer.stage(stageInput())).toMatchObject({ ok: false, code: 'forbidden' })
    expect([...harness.calls, ...loggedOut.harness.calls]).toEqual([])
  })

  it('reports a certificate mismatch as an identity failure, with nothing staged', async () => {
    const { deployer, harness } = await setup({
      replies: {
        'GET /api/mqtt/capabilities': new RuntimeIdentityError('runtime_identity_mismatch', 'certificate changed'),
      },
    })
    expect(await deployer.stage(stageInput())).toEqual({
      ok: false,
      code: 'runtime_identity_mismatch',
      message: 'certificate changed',
    })
    expect(harness.calls.map((c) => c.method)).toEqual(['GET'])
  })

  it('reports an unreachable runtime without echoing the transport error', async () => {
    const { deployer } = await setup({
      replies: { [`POST ${MQTT_STAGING_PATH}`]: new Error(`socket hang up ${PASSWORD}`) },
    })
    const result = await deployer.stage(stageInput())
    expect(result).toMatchObject({ ok: false, code: 'runtime_unreachable' })
    expect(JSON.stringify(result)).not.toContain(PASSWORD)
  })

  it('does not send a secret to a runtime that cannot store it', async () => {
    const capabilities = fixture('capabilities.json')
    const { deployer, harness } = await setup({
      replies: {
        'GET /api/mqtt/capabilities': {
          status: 200,
          body: { ...capabilities, credentials: { ...(capabilities.credentials as object), methods: [] } },
        },
      },
    })
    expect(await deployer.stage(stageInput())).toMatchObject({ ok: false, code: 'credential_method_mismatch' })
    expect(harness.calls.map((c) => c.method)).toEqual(['GET'])
    const old = await setup({ replies: { 'GET /api/mqtt/capabilities': { status: 404, body: 'Not Found' } } })
    expect(await old.deployer.stage(stageInput())).toMatchObject({ ok: false, code: 'runtime_request_failed' })
    expect(old.harness.calls.map((c) => c.method)).toEqual(['GET'])
  })

  it('passes the runtime refusal code through', async () => {
    const { deployer } = await setup({
      replies: {
        [`POST ${MQTT_STAGING_PATH}`]: {
          status: 400,
          body: { error: { code: 'client_key_mismatch', category: 'certificate', message: 'key does not match' } },
        },
      },
    })
    expect(await deployer.stage(stageInput())).toEqual({
      ok: false,
      code: 'client_key_mismatch',
      message: 'key does not match',
    })
  })

  it('refuses a receipt that carries secret material or belongs to another program or broker', async () => {
    for (const body of [
      fixture('invalid-staging-receipt-with-ciphertext.json'),
      receipt('username_password', { programMd5: 'a'.repeat(32) }),
      receipt('username_password', {
        binding: {
          host: 'evil.example',
          port: 8883,
          tls_enabled: true,
          client_id: 'plc-linha1',
          method: 'username_password',
        },
      }),
    ]) {
      const { deployer } = await setup({ replies: { [`POST ${MQTT_STAGING_PATH}`]: { status: 201, body } } })
      expect(await deployer.stage(stageInput())).toMatchObject({ ok: false, code: 'runtime_response_invalid' })
    }
  })

  it('reuses the runtime active credential for the same broker when nothing is saved locally', async () => {
    const active = fixture('credentials-active-and-staged.json')
    const { deployer, harness } = await setup({
      secret: null,
      replies: { 'GET /api/mqtt/credentials': { status: 200, body: active } },
    })
    expect(await deployer.stage(stageInput())).toEqual({
      ok: true,
      credentialRef: { id: '6f1c2a4e-8d3b-4c5a-9e7f-0a1b2c3d4e5f', revision: 3, staging_id: null },
      stagingId: null,
    })
    expect(harness.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /api/mqtt/credentials'])
    expect(harness.lines.at(-1)).toContain('result=reused_active')
  })

  it('never reuses an active credential bound to another broker or method', async () => {
    const active = fixture('credentials-active-and-staged.json')
    const moved = {
      ...integration('username_password'),
      connection: { ...integration('username_password').connection, host: 'other.example.net' },
    }
    const { deployer } = await setup({
      secret: null,
      replies: { 'GET /api/mqtt/credentials': { status: 200, body: active } },
    })
    expect(await deployer.stage({ ...stageInput(), integration: moved })).toMatchObject({
      ok: false,
      code: 'config_credential_missing',
    })
    expect(await deployer.stage(stageInput('client_certificate'))).toMatchObject({
      ok: false,
      code: 'config_credential_missing',
    })
  })

  it('names a local credential saved for another broker instead of sending it', async () => {
    const { deployer, harness } = await setup({
      storedBinding: { ...bindingOf('username_password'), host: 'old-broker.example.net' },
    })
    expect(await deployer.stage(stageInput())).toMatchObject({ ok: false, code: 'config_credential_binding_mismatch' })
    expect(harness.calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('refuses a credentials body that does not follow the contract', async () => {
    const { deployer } = await setup({
      secret: null,
      replies: {
        'GET /api/mqtt/credentials': { status: 200, body: fixture('invalid-credentials-with-password.json') },
      },
    })
    expect(await deployer.stage(stageInput())).toMatchObject({ ok: false, code: 'runtime_response_invalid' })
  })

  it('refuses an anonymous integration, which has nothing to stage', async () => {
    const { deployer } = await setup({})
    const anonymous = { ...stageInput(), integration: createDefaultMqttIntegration('plc-linha1') }
    expect(await deployer.stage(anonymous)).toMatchObject({ ok: false, code: 'internal_error' })
  })

  it('cancels a staging on the same pinned runtime and swallows failures', async () => {
    const stagingId = '0d9e8f7a-6b5c-4d3e-8f1a-2b3c4d5e6f70'
    const { deployer, harness } = await setup({})
    await deployer.discard(ADDRESS, stagingId)
    expect(harness.calls).toMatchObject([
      { method: 'DELETE', path: `${MQTT_STAGING_PATH}/${stagingId}`, address: ADDRESS, sha256: PIN },
    ])
    await deployer.discard(ADDRESS, '../../api/stop-plc')
    expect(harness.calls).toHaveLength(1)
    const failing = await setup({ replies: { [`DELETE ${MQTT_STAGING_PATH}/:id`]: new Error('down') } })
    await expect(failing.deployer.discard(ADDRESS, stagingId)).resolves.toBeUndefined()
    const unpinned = await setup({ pinned: false })
    await unpinned.deployer.discard(ADDRESS, stagingId)
    expect(unpinned.harness.calls).toEqual([])
  })
})
