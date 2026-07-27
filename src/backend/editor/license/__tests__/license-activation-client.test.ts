import { generateKeyPairSync, verify as cryptoVerify } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { checkDeviceActivation } from '../license-activation-client'

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
