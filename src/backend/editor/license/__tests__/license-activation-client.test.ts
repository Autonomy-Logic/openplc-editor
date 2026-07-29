import { generateKeyPairSync, verify as cryptoVerify } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EventEmitter } from 'events'
import https from 'https'

import { checkDeviceActivation } from '../license-activation-client'

/** Fake `https.request`: invokes the response callback synchronously and
 *  emits the given status/body when `req.end()` is called, so `postJson`'s
 *  promise resolves without a real socket. Returns the `req` mock so tests
 *  can assert on the body written via `req.write`. */
function mockHttpsResponse(statusCode: number, jsonBody: unknown) {
  const req = Object.assign(new EventEmitter(), { write: jest.fn(), end: jest.fn(), setTimeout: jest.fn() })
  jest.spyOn(https, 'request').mockImplementation(((_options: unknown, callback: (res: unknown) => void) => {
    const res = Object.assign(new EventEmitter(), { statusCode, statusMessage: 'OK', setEncoding: jest.fn() })
    callback(res)
    req.end.mockImplementation(() => {
      res.emit('data', JSON.stringify(jsonBody))
      res.emit('end')
    })
    return req as unknown as ReturnType<typeof https.request>
  }) as typeof https.request)
  return req
}

const INPUT = { deviceId: '659a3520540f803625ddc34081e893d3', vppId: '29a17c7c2486d355', packageId: 'com.openplc.espressif' }

// Golden 98-byte blob hex from on-device-license-storage's license-golden.json
// (expectedBytesHex). The mock must emit exactly these bytes.
const GOLDEN_HEX =
  '4f504c430100000102030405060708090a0b0c0d0e0fa0a1a2a3a4a5a6a711111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111b6311445'

describe('checkDeviceActivation (mock toggle)', () => {
  const original = process.env.OPLC_LICENSE_MOCK

  afterEach(() => {
    if (original === undefined) delete process.env.OPLC_LICENSE_MOCK
    else process.env.OPLC_LICENSE_MOCK = original
  })

  it('returns licensed + a 98-byte golden blob when OPLC_LICENSE_MOCK=licensed', async () => {
    process.env.OPLC_LICENSE_MOCK = 'licensed'
    const result = await checkDeviceActivation(INPUT)
    expect(result.licensed).toBe(true)
    expect(result.license).toHaveLength(98)
    expect(Buffer.from(result.license!).toString('hex')).toBe(GOLDEN_HEX)
  })

  it('returns licensed:false with no blob when OPLC_LICENSE_MOCK=demo', async () => {
    process.env.OPLC_LICENSE_MOCK = 'demo'
    const result = await checkDeviceActivation(INPUT)
    expect(result.licensed).toBe(false)
    expect(result.license).toBeUndefined()
  })
})

/**
 * SECURITY (audit 2026-07-28): a shipped editor must not contain a
 * license-minting path. `MOCK_ENABLED` is compared against a literal that
 * webpack inlines, so the branch is dead code in a production build — but only
 * if nothing reintroduces a runtime read. This asserts the module honours
 * NODE_ENV at LOAD time, which is the property the build relies on.
 */
describe('checkDeviceActivation (mock is compiled out of production builds)', () => {
  const originalEnv = process.env.NODE_ENV
  const originalMock = process.env.OPLC_LICENSE_MOCK

  afterEach(() => {
    process.env.NODE_ENV = originalEnv
    if (originalMock === undefined) delete process.env.OPLC_LICENSE_MOCK
    else process.env.OPLC_LICENSE_MOCK = originalMock
    jest.restoreAllMocks()
    jest.resetModules()
  })

  it('ignores OPLC_LICENSE_MOCK and calls the real endpoint when NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production'
    process.env.OPLC_LICENSE_MOCK = 'licensed'
    jest.resetModules()
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../license-activation-client') as typeof import('../license-activation-client')

    // The backend answers "not licensed"; if the mock were still reachable we
    // would get the golden blob instead.
    mockHttpsResponse(200, { statusCode: 200, data: { licensed: false } })
    const result = await mod.checkDeviceActivation(INPUT)

    expect(https.request).toHaveBeenCalled()
    expect(result.licensed).toBe(false)
    expect(result.license).toBeUndefined()
  })
})

describe('checkDeviceActivation (signed mock, keyId keystore — D69f/P1-3)', () => {
  const originalMock = process.env.OPLC_LICENSE_MOCK
  const originalKey = process.env.OPLC_LICENSE_MOCK_KEY
  const KEY_ID = 'test-vpp-2026'
  let storeDir: string
  let publicPem: string

  beforeAll(() => {
    // A real per-VPP EC P-256 keystore: <dir>/<keyId>.private.pem.
    storeDir = mkdtempSync(join(tmpdir(), 'lic-keystore-'))
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    writeFileSync(join(storeDir, `${KEY_ID}.private.pem`), privateKey.export({ type: 'pkcs8', format: 'pem' }) as string)
    publicPem = publicKey.export({ type: 'spki', format: 'pem' }) as string
    process.env.OPLC_LICENSE_MOCK = 'licensed'
  })

  afterAll(() => {
    rmSync(storeDir, { recursive: true, force: true })
    if (originalMock === undefined) delete process.env.OPLC_LICENSE_MOCK
    else process.env.OPLC_LICENSE_MOCK = originalMock
    if (originalKey === undefined) delete process.env.OPLC_LICENSE_MOCK_KEY
    else process.env.OPLC_LICENSE_MOCK_KEY = originalKey
  })

  it('resolves the key by keyId from the keystore dir and signs a real, verifiable blob', async () => {
    process.env.OPLC_LICENSE_MOCK_KEY = storeDir
    const result = await checkDeviceActivation({ ...INPUT, keyId: KEY_ID })
    expect(result.licensed).toBe(true)
    const blob = Buffer.from(result.license!)
    expect(blob).toHaveLength(98)
    expect(blob.toString('hex')).not.toBe(GOLDEN_HEX) // a real signature, not the filler golden
    // Layout: magic(LE) | fmt | keyId | deviceId[16]@6 | productId[8]@22 | sig[64]@30 | crc[4]@94
    expect(blob.readUInt32LE(0)).toBe(0x434c504f)
    expect(blob.subarray(6, 22).toString('hex')).toBe(INPUT.deviceId)
    expect(blob.subarray(22, 30).toString('hex')).toBe(INPUT.vppId)
    // The signature verifies against the keystore's public key over payload[0..29].
    const payload = Uint8Array.from(blob.subarray(0, 30))
    const sig = Uint8Array.from(blob.subarray(30, 94))
    expect(cryptoVerify('sha256', payload, { key: publicPem, dsaEncoding: 'ieee-p1363' }, sig)).toBe(true)
  })

  it('errors when the keystore is a directory but no keyId is provided', async () => {
    process.env.OPLC_LICENSE_MOCK_KEY = storeDir
    const result = await checkDeviceActivation(INPUT) // no keyId
    expect(result.licensed).toBe(false)
    expect(result.error).toMatch(/keyId/)
  })

  it('errors when the keyId names a key absent from the keystore', async () => {
    process.env.OPLC_LICENSE_MOCK_KEY = storeDir
    const result = await checkDeviceActivation({ ...INPUT, keyId: 'no-such-key-2026' })
    expect(result.licensed).toBe(false)
    expect(result.error).toMatch(/mock sign failed/)
  })

  it('still accepts a single-file OPLC_LICENSE_MOCK_KEY (back-compat)', async () => {
    // Point the env straight at the PEM file; keyId is ignored for a file value.
    const fileDir = mkdtempSync(join(tmpdir(), 'lic-file-'))
    mkdirSync(fileDir, { recursive: true })
    const filePath = join(fileDir, 'single.pem')
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    writeFileSync(filePath, privateKey.export({ type: 'pkcs8', format: 'pem' }) as string)
    process.env.OPLC_LICENSE_MOCK_KEY = filePath
    const result = await checkDeviceActivation(INPUT) // no keyId needed for a file
    expect(result.licensed).toBe(true)
    expect(result.license).toHaveLength(98)
    rmSync(fileDir, { recursive: true, force: true })
  })
})

describe('checkDeviceActivation (real edge client, no mock toggle)', () => {
  const original = process.env.OPLC_LICENSE_MOCK

  beforeEach(() => {
    delete process.env.OPLC_LICENSE_MOCK
  })

  afterEach(() => {
    jest.restoreAllMocks()
    if (original === undefined) delete process.env.OPLC_LICENSE_MOCK
    else process.env.OPLC_LICENSE_MOCK = original
  })

  it('sends ONLY { deviceId, packageId } to the edge -- no vppId, no keyId on the wire', async () => {
    const licenseB64 = Buffer.from(GOLDEN_HEX, 'hex').toString('base64')
    const req = mockHttpsResponse(200, {
      statusCode: 200,
      data: { licensed: true, deviceId: INPUT.deviceId, vppId: INPUT.packageId, license: licenseB64 },
    })

    const result = await checkDeviceActivation({ ...INPUT, keyId: 'should-never-be-sent' })

    expect(result.licensed).toBe(true)
    const sentBody = JSON.parse((req.write as jest.Mock).mock.calls[0][0] as string)
    expect(sentBody).toEqual({ deviceId: INPUT.deviceId, packageId: INPUT.packageId })
  })

  it('base64-decodes the license blob from the edge response into 98 bytes', async () => {
    const licenseB64 = Buffer.from(GOLDEN_HEX, 'hex').toString('base64')
    mockHttpsResponse(200, { statusCode: 200, data: { licensed: true, license: licenseB64 } })

    const result = await checkDeviceActivation(INPUT)

    expect(result.license).toHaveLength(98)
    expect(Buffer.from(result.license!).toString('hex')).toBe(GOLDEN_HEX)
  })

  it('passes through licensed:false with a reason (no purchase/entitlement)', async () => {
    mockHttpsResponse(200, { statusCode: 200, data: { licensed: false, reason: 'no active subscription' } })

    const result = await checkDeviceActivation(INPUT)

    expect(result.licensed).toBe(false)
    expect(result.reason).toBe('no active subscription')
    expect(result.license).toBeUndefined()
  })

  it('resolves licensed:false with an error when licensed:true but license is missing', async () => {
    mockHttpsResponse(200, { statusCode: 200, data: { licensed: true } })

    const result = await checkDeviceActivation(INPUT)

    expect(result.licensed).toBe(false)
    expect(result.error).toMatch(/missing license blob/)
  })

  it('resolves licensed:false on a non-2xx response instead of throwing', async () => {
    mockHttpsResponse(404, { statusCode: 404, data: { message: 'Unknown VPP' } })

    const result = await checkDeviceActivation(INPUT)

    expect(result.licensed).toBe(false)
    expect(result.error).toMatch(/404/)
  })

  // Buffer.from(s, 'base64') never throws -- it skips invalid characters and
  // tolerates missing padding -- so without an explicit length check a
  // truncated field reaches the device as a short blob and comes back as a
  // LIC_CORRUPT rejection that blames the hardware.
  it('rejects a license blob that does not decode to exactly 98 bytes', async () => {
    const truncated = Buffer.from(GOLDEN_HEX, 'hex').subarray(0, 40).toString('base64')
    mockHttpsResponse(200, { statusCode: 200, data: { licensed: true, license: truncated } })

    const result = await checkDeviceActivation(INPUT)

    expect(result.licensed).toBe(false)
    expect(result.error).toMatch(/40 bytes, expected 98/)
    expect(result.license).toBeUndefined()
  })

  it('rejects a license field that is not valid base64 at all', async () => {
    mockHttpsResponse(200, { statusCode: 200, data: { licensed: true, license: '!!!not base64!!!' } })

    const result = await checkDeviceActivation(INPUT)

    expect(result.licensed).toBe(false)
    expect(result.error).toMatch(/expected 98/)
  })
})
