import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import cases from '../../contract/fixtures/api/cases.json'
import errorCodes from '../../contract/fixtures/errors/error-codes.json'
import {
  MQTT_ERROR_CATEGORIES,
  MQTT_RUNTIME_STATES,
  parseMqttRuntimeCredentials,
  parseMqttRuntimeStatus,
} from '../status'

const API = join(__dirname, '..', '..', 'contract', 'fixtures', 'api')

const load = (file: string): unknown => JSON.parse(readFileSync(join(API, file), 'utf-8'))

type JsonObject = { [key: string]: unknown }

const objectAt = (file: string): JsonObject => {
  const value = load(file)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${file} is not an object`)
  return { ...value }
}

const withMember = (base: JsonObject, path: string[], value: unknown): JsonObject => {
  const [head, ...rest] = path
  if (rest.length === 0) return { ...base, [head]: value }
  const child = base[head]
  if (typeof child !== 'object' || child === null || Array.isArray(child)) throw new Error(`${head} is not an object`)
  return { ...base, [head]: withMember({ ...child }, rest, value) }
}

const withoutMember = (base: JsonObject, key: string): JsonObject =>
  Object.fromEntries(Object.entries(base).filter(([k]) => k !== key))

describe('runtime MQTT API parsers against the shared fixtures', () => {
  it.each(cases.cases.filter((c) => c.def === 'status'))('status $file valid=$valid', ({ file, valid }) => {
    expect(parseMqttRuntimeStatus(load(file)) !== null).toBe(valid)
  })

  it.each(cases.cases.filter((c) => c.def === 'credentials'))('credentials $file valid=$valid', ({ file, valid }) => {
    expect(parseMqttRuntimeCredentials(load(file)) !== null).toBe(valid)
  })

  it('declares exactly the states and categories of the contract', () => {
    expect([...MQTT_ERROR_CATEGORIES]).toEqual(errorCodes.categories)
    expect([...MQTT_RUNTIME_STATES]).toEqual([
      'disabled',
      'plc_stopped',
      'connecting',
      'connected',
      'retry_wait',
      'config_error',
      'credential_error',
    ])
  })
})

describe('parseMqttRuntimeStatus', () => {
  const retry = objectAt('status-retry-certificate-error.json')
  const connected = objectAt('status-connected-sparkplug.json')

  it('keeps every reported field of a valid body', () => {
    const status = parseMqttRuntimeStatus(retry)
    expect(status?.state).toBe('retry_wait')
    expect(status?.error?.category).toBe('certificate')
    expect(status?.reconnect).toEqual({ attempt: 4, nextRetryInMs: 17120 })
    expect(parseMqttRuntimeStatus(connected)?.sparkplug).toEqual({
      bdSeq: 7,
      seq: 42,
      lastBirthAt: '2026-10-09T12:00:01.300Z',
    })
  })

  it.each<[string, unknown]>([
    ['not an object', 'connected'],
    ['an array', []],
    ['null', null],
  ])('rejects %s', (_label, body) => {
    expect(parseMqttRuntimeStatus(body)).toBeNull()
  })

  it.each<[string, JsonObject]>([
    ['unknown member', { ...retry, password: 'x' }],
    ['missing required member', withoutMember(retry, 'since')],
    ['other contract', { ...retry, contract: 'openplc-mqtt-capabilities' }],
    ['other version', { ...retry, version: 2 }],
    ['configured not boolean', { ...retry, configured: 'yes' }],
    ['timestamp without milliseconds', { ...retry, since: '2026-10-09T12:00:00Z' }],
    ['unknown mode', { ...retry, mode: 'both' }],
    ['upper-case md5', { ...retry, programMd5: '3F2C9D0E8B7A6F5E4D3C2B1A09F8E7D6' }],
    ['unknown error category', withMember(retry, ['error', 'category'], 'disk')],
    ['error code with upper case', withMember(retry, ['error', 'code'], 'Auth_rejected')],
    ['error message over 512', withMember(retry, ['error', 'message'], 'x'.repeat(513))],
    ['error count zero', withMember(retry, ['error', 'count'], 0)],
    ['error with extra member', withMember(retry, ['error', 'detail'], 'x')],
    ['broker port not integer', withMember(retry, ['broker', 'port'], 1.5)],
    ['broker tls not boolean', withMember(retry, ['broker', 'tls'], 'true')],
    ['negative reconnect attempt', withMember(retry, ['reconnect', 'attempt'], -1)],
    ['negative next retry', withMember(retry, ['reconnect', 'nextRetryInMs'], -5)],
    ['stats leaves over 1000', withMember(retry, ['stats', 'leaves'], 1001)],
    ['stats sample timestamp malformed', withMember(retry, ['stats', 'lastSampleAt'], 'yesterday')],
    ['stats negative dropped', withMember(retry, ['stats', 'dropped'], -1)],
    ['bdSeq over 255', withMember(connected, ['sparkplug', 'bdSeq'], 256)],
    ['seq not integer', withMember(connected, ['sparkplug', 'seq'], '1')],
    ['birth timestamp malformed', withMember(connected, ['sparkplug', 'lastBirthAt'], 5)],
  ])('rejects a body with %s', (_label, body) => {
    expect(parseMqttRuntimeStatus(body)).toBeNull()
  })
})

describe('parseMqttRuntimeCredentials', () => {
  const credentials = objectAt('credentials-active-and-staged.json')
  const staged = (): JsonObject[] => {
    const list = credentials.staged
    if (!Array.isArray(list)) throw new Error('staged is not a list')
    return list.map((entry: unknown) => {
      if (typeof entry !== 'object' || entry === null) throw new Error('staged entry is not an object')
      return { ...entry }
    })
  }

  it('accepts no active credential and no staging', () => {
    expect(parseMqttRuntimeCredentials({ active: null, staged: [] })).toEqual({ active: null, staged: [] })
  })

  it.each<[string, unknown]>([
    ['not an object', []],
    ['staged not a list', { ...credentials, staged: {} }],
    [
      'more than four staged',
      { ...credentials, staged: [...staged(), ...staged(), ...staged(), ...staged(), ...staged()] },
    ],
    ['unknown member', { ...credentials, ciphertext: 'AAAA' }],
    ['active id not uuid v4', withMember(credentials, ['active', 'id'], 'abc')],
    ['active revision zero', withMember(credentials, ['active', 'revision'], 0)],
    ['active method anonymous', withMember(credentials, ['active', 'method'], 'anonymous')],
    ['binding host empty', withMember(credentials, ['active', 'binding', 'host'], '')],
    ['binding port out of range', withMember(credentials, ['active', 'binding', 'port'], 70000)],
    ['binding client id invalid', withMember(credentials, ['active', 'binding', 'client_id'], '-x')],
    ['binding with password', withMember(credentials, ['active', 'binding', 'password'], 'x')],
    ['usernameSet not boolean', withMember(credentials, ['active', 'usernameSet'], 'yes')],
    ['updatedBy over 128', withMember(credentials, ['active', 'updatedBy'], 'x'.repeat(129))],
    [
      'certificate sha256 malformed',
      {
        ...credentials,
        staged: [
          { ...staged()[0], clientCertificate: { sha256: 'x', subject: 'CN=a', notAfter: '2027-10-09T00:00:00.000Z' } },
        ],
      },
    ],
    [
      'staging ref without staging id',
      {
        ...credentials,
        staged: [
          {
            ...staged()[0],
            credentialRef: { id: '6f1c2a4e-8d3b-4c5a-9e7f-0a1b2c3d4e5f', revision: 4, staging_id: null },
          },
        ],
      },
    ],
    ['staging md5 malformed', { ...credentials, staged: [{ ...staged()[0], programMd5: 'x' }] }],
  ])('rejects %s', (_label, body) => {
    expect(parseMqttRuntimeCredentials(body)).toBeNull()
  })
})
