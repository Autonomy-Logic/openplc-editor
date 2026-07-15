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
