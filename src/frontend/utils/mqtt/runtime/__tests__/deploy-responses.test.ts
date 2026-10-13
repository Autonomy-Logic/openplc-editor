import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { parseMqttApiError, parseMqttCapabilities, parseMqttStagingReceipt } from '../status'
import { describeRuntimeMqttConfigError, readRuntimeUploadRejection } from '../upload-response'

const API = join(__dirname, '..', '..', 'contract', 'fixtures', 'api')
const load = (file: string): unknown => JSON.parse(readFileSync(join(API, file), 'utf-8'))

describe('staging receipt', () => {
  it('accepts the C0 receipt fixture', () => {
    expect(parseMqttStagingReceipt(load('staging-receipt.json'))).toEqual(load('staging-receipt.json'))
  })

  it('refuses a receipt that carries secret material or misses members', () => {
    expect(parseMqttStagingReceipt(load('invalid-staging-receipt-with-ciphertext.json'))).toBeNull()
    const receipt = load('staging-receipt.json')
    if (typeof receipt !== 'object' || receipt === null) throw new Error('fixture')
    expect(parseMqttStagingReceipt({ ...receipt, password: 'x' })).toBeNull()
    const { stagingId: _drop, ...withoutId } = receipt as Record<string, unknown>
    expect(parseMqttStagingReceipt(withoutId)).toBeNull()
  })
})

describe('MQTT API error body', () => {
  it('reads the C0 error fixture', () => {
    expect(parseMqttApiError(load('error-staging-binding-mismatch.json'))).toEqual({
      code: 'credential_binding_mismatch',
      category: 'credential',
      message: 'Configuration broker does not match the staged credential binding',
      pointer: '/connection/host',
    })
  })

  it('refuses unknown categories, codes or extra members', () => {
    expect(parseMqttApiError({ error: { code: 'x', category: 'credential', message: 'm' } })).toBeNull()
    expect(parseMqttApiError({ error: { code: 'abc', category: 'nope', message: 'm' } })).toBeNull()
    expect(parseMqttApiError({ error: { code: 'abc', category: 'credential', message: 'm', secret: 1 } })).toBeNull()
    expect(parseMqttApiError({ error: { code: 'abc', category: 'credential', message: 'm' }, x: 1 })).toBeNull()
    expect(parseMqttApiError('text')).toBeNull()
  })
})

describe('MQTT capabilities', () => {
  it('reads formats, modes and credential methods from the C0 fixture', () => {
    expect(parseMqttCapabilities(load('capabilities.json'))).toEqual({
      formatVersions: [1],
      modes: ['generic', 'sparkplug_b'],
      methods: ['username_password', 'client_certificate'],
    })
  })

  it('reports a runtime without secret methods and refuses other contracts', () => {
    const fixture = load('capabilities.json')
    if (typeof fixture !== 'object' || fixture === null) throw new Error('fixture')
    const base = fixture as Record<string, unknown>
    expect(parseMqttCapabilities({ ...base, credentials: { api: 1, methods: [] } })?.methods).toEqual([])
    expect(parseMqttCapabilities({ ...base, contract: 'other' })).toBeNull()
    expect(parseMqttCapabilities({ ...base, version: 2 })).toBeNull()
    expect(parseMqttCapabilities({ ...base, runtimeConfig: { contract: 'x', formatVersions: [1] } })).toBeNull()
    expect(parseMqttCapabilities(null)).toBeNull()
  })
})

describe('upload response', () => {
  it('treats an empty UploadFileFail as accepted', () => {
    expect(readRuntimeUploadRejection('{"UploadFileFail":"","CompilationStatus":"COMPILING"}')).toBeNull()
    expect(readRuntimeUploadRejection('not json')).toBeNull()
    expect(readRuntimeUploadRejection('[]')).toBeNull()
  })

  it('reads a refusal and the structured MQTT error the runtime adds', () => {
    const body = JSON.stringify({
      UploadFileFail: "MQTT configuration rejected: staging_expired at '/auth/credential_ref/staging_id': expired",
      CompilationStatus: 'FAILED',
      MqttConfigError: {
        code: 'staging_expired',
        category: 'credential',
        message: 'the staged credential expired',
        pointer: '/auth/credential_ref/staging_id',
      },
    })
    const rejection = readRuntimeUploadRejection(body)
    expect(rejection?.reason).toContain('staging_expired')
    expect(rejection?.mqtt).toEqual({
      code: 'staging_expired',
      category: 'credential',
      message: 'the staged credential expired',
      pointer: '/auth/credential_ref/staging_id',
    })
    if (rejection?.mqtt) {
      expect(describeRuntimeMqttConfigError(rejection.mqtt)).toBe(
        'MQTT Configuration Error (runtime, credential): the staged credential expired [staging_expired at /auth/credential_ref/staging_id]',
      )
    }
  })

  it('keeps a refusal whose MQTT detail is malformed, without the detail', () => {
    const body = JSON.stringify({ UploadFileFail: 'busy', MqttConfigError: { code: 'X', category: 'credential' } })
    expect(readRuntimeUploadRejection(body)).toEqual({ reason: 'busy', mqtt: null })
  })
})
