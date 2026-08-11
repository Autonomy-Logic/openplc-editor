import { EventEmitter } from 'events'
import http from 'http'
import https from 'https'

import { checkDeviceActivation } from '../license-activation-client'

/**
 * Fake `request`: invokes the response callback synchronously and emits the given
 * status/body when `req.end()` is called, so `postJson`'s promise resolves without
 * a real socket. Returns the `req` mock so tests can assert on the body written.
 */
function mockResponse(statusCode: number, jsonBody: unknown, mod: typeof https | typeof http = https) {
  const req = Object.assign(new EventEmitter(), { write: jest.fn(), end: jest.fn(), setTimeout: jest.fn() })
  jest.spyOn(mod, 'request').mockImplementation(((_options: unknown, callback: (res: unknown) => void) => {
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

const INPUT = {
  deviceId: '659a3520540f803625ddc34081e893d3',
  packageId: 'com.openplc.espressif-licensed',
}

/** The golden 98-byte blob, hex — same vector as `license-golden.json`. */
const GOLDEN_HEX =
  '4f504c430100000102030405060708090a0b0c0d0e0fa0a1a2a3a4a5a6a711111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111b6311445'

const GOLDEN_B64 = Buffer.from(GOLDEN_HEX, 'hex').toString('base64')

afterEach(() => {
  jest.restoreAllMocks()
})

describe('checkDeviceActivation', () => {
  it('sends only { deviceId, packageId } and returns the decoded 98-byte blob', async () => {
    const req = mockResponse(200, {
      statusCode: 200,
      data: { licensed: true, deviceId: INPUT.deviceId, vppId: INPUT.packageId, license: GOLDEN_B64 },
    })

    const result = await checkDeviceActivation(INPUT)

    expect(result.licensed).toBe(true)
    expect(result.license).toHaveLength(98)
    expect(Buffer.from(result.license ?? []).toString('hex')).toBe(GOLDEN_HEX)

    // Whole-key equality, not a per-field check: an extra field creeping back in
    // (a nonce, a signature, a client-declared hwClass) has to fail here.
    const sent = JSON.parse((req.write as jest.Mock).mock.calls[0][0] as string) as Record<string, unknown>
    expect(Object.keys(sent).sort()).toEqual(['deviceId', 'packageId'])
  })

  it('passes through licensed:false with a reason (no purchase on record)', async () => {
    mockResponse(200, { statusCode: 200, data: { licensed: false, reason: 'no active subscription' } })

    const result = await checkDeviceActivation(INPUT)

    // `reason` present and `error` absent is what tells the caller demo mode is
    // the CORRECT outcome, rather than a failure to reach the backend.
    expect(result.licensed).toBe(false)
    expect(result.reason).toBe('no active subscription')
    expect(result.error).toBeUndefined()
    expect(result.license).toBeUndefined()
  })

  it('reports a non-2xx as an error, not as "no purchase"', async () => {
    // A 404 (unknown package), 429 (rate limited) or 503 (no signer) must NOT
    // read as "this device has no license" — that is how someone who already paid
    // gets told to buy again.
    mockResponse(404, { statusCode: 404, data: { message: 'Unknown VPP' } })

    const result = await checkDeviceActivation(INPUT)

    expect(result.licensed).toBe(false)
    expect(result.error).toMatch(/404/)
    expect(result.reason).toBeUndefined()
  })

  it('reports a transport failure as an error rather than throwing', async () => {
    jest.spyOn(https, 'request').mockImplementation(((_options: unknown, _callback: unknown) => {
      const emitter = new EventEmitter()
      const req = Object.assign(emitter, {
        write: jest.fn(),
        end: jest.fn(() => {
          emitter.emit('error', new Error('ECONNREFUSED'))
        }),
        setTimeout: jest.fn(),
      })
      return req as unknown as ReturnType<typeof https.request>
    }) as typeof https.request)

    const result = await checkDeviceActivation(INPUT)

    expect(result.licensed).toBe(false)
    expect(result.error).toMatch(/ECONNREFUSED/)
  })

  it('rejects a response whose shape is off-contract', async () => {
    mockResponse(200, { statusCode: 200, data: { somethingElse: true } })

    const result = await checkDeviceActivation(INPUT)

    expect(result.licensed).toBe(false)
    expect(result.error).toMatch(/Unexpected activation response shape/)
  })

  it('rejects licensed:true with no license field', async () => {
    mockResponse(200, { statusCode: 200, data: { licensed: true } })

    const result = await checkDeviceActivation(INPUT)

    expect(result.licensed).toBe(false)
    expect(result.error).toMatch(/missing license blob/)
  })

  it('rejects a blob that does not decode to exactly 98 bytes', async () => {
    // `Buffer.from(s, 'base64')` never throws — it skips invalid characters and
    // tolerates missing padding — so without an explicit length check a truncated
    // field reaches the device as a short blob and comes back as a LIC_CORRUPT
    // rejection that blames the hardware.
    const truncated = Buffer.from(GOLDEN_HEX, 'hex').subarray(0, 40).toString('base64')
    mockResponse(200, { statusCode: 200, data: { licensed: true, license: truncated } })

    const result = await checkDeviceActivation(INPUT)

    expect(result.licensed).toBe(false)
    expect(result.error).toMatch(/40 bytes, expected 98/)
    expect(result.license).toBeUndefined()
  })

  it('rejects a license field that is not base64 at all', async () => {
    mockResponse(200, { statusCode: 200, data: { licensed: true, license: '!!!not base64!!!' } })

    const result = await checkDeviceActivation(INPUT)

    expect(result.licensed).toBe(false)
    expect(result.error).toMatch(/expected 98/)
  })

  it('accepts a response that is not wrapped in the { statusCode, data } envelope', async () => {
    mockResponse(200, { licensed: true, license: GOLDEN_B64 })

    const result = await checkDeviceActivation(INPUT)

    expect(result.licensed).toBe(true)
    expect(result.license).toHaveLength(98)
  })
})

/**
 * There is NO dev license-minting path in this module.
 *
 * The removed mock (`OPLC_LICENSE_MOCK` / `OPLC_LICENSE_MOCK_KEY`) signed real,
 * device-bound blobs a board would accept as FULL. It was compiled out of
 * production builds, but it still shipped in dev builds and was one key leak away
 * from unlimited offline licenses outside purchase and outside revocation.
 *
 * These tests assert the ABSENCE. A happy-path test would pass just as well with
 * the mock silently reintroduced.
 */
describe('checkDeviceActivation (no dev mock)', () => {
  const originalMock = process.env.OPLC_LICENSE_MOCK
  const originalKey = process.env.OPLC_LICENSE_MOCK_KEY

  afterEach(() => {
    if (originalMock === undefined) delete process.env.OPLC_LICENSE_MOCK
    else process.env.OPLC_LICENSE_MOCK = originalMock
    if (originalKey === undefined) delete process.env.OPLC_LICENSE_MOCK_KEY
    else process.env.OPLC_LICENSE_MOCK_KEY = originalKey
  })

  it('still calls the backend, and honours its answer, with OPLC_LICENSE_MOCK=licensed set', async () => {
    process.env.OPLC_LICENSE_MOCK = 'licensed'
    mockResponse(200, { statusCode: 200, data: { licensed: false } })

    const result = await checkDeviceActivation(INPUT)

    // If a mock were reachable this would be `true` with a minted blob.
    expect(https.request).toHaveBeenCalled()
    expect(result.licensed).toBe(false)
    expect(result.license).toBeUndefined()
  })

  it('still calls the backend with OPLC_LICENSE_MOCK=demo set', async () => {
    process.env.OPLC_LICENSE_MOCK = 'demo'
    mockResponse(200, { statusCode: 200, data: { licensed: true, license: GOLDEN_B64 } })

    const result = await checkDeviceActivation(INPUT)

    // A `demo` short-circuit would have returned licensed:false without a request.
    expect(https.request).toHaveBeenCalled()
    expect(result.licensed).toBe(true)
  })
})

/**
 * NO proof of possession.
 *
 * The activate request used to be preceded by `POST /vpp-licenses/challenge` and
 * to carry `nonce` + `signature` signed by a keypair derived from the hardware
 * anchor. All of it is gone: on bare metal the anchor is read inside the closed
 * license-core and the blob is bound to `deviceId`, so the silicon is what proves
 * possession. This asserts the absence.
 */
describe('checkDeviceActivation (no proof of possession)', () => {
  it('makes exactly one request, and it is the activate', async () => {
    const hits: string[] = []
    jest.spyOn(https, 'request').mockImplementation(((options: unknown, callback: (res: unknown) => void) => {
      hits.push(options && typeof options === 'object' && 'path' in options ? String(options.path) : '')
      const req = Object.assign(new EventEmitter(), { write: jest.fn(), end: jest.fn(), setTimeout: jest.fn() })
      const res = Object.assign(new EventEmitter(), { statusCode: 200, statusMessage: 'OK', setEncoding: jest.fn() })
      callback(res)
      req.end.mockImplementation(() => {
        res.emit('data', JSON.stringify({ statusCode: 200, data: { licensed: true, license: GOLDEN_B64 } }))
        res.emit('end')
      })
      return req as unknown as ReturnType<typeof https.request>
    }) as typeof https.request)

    const result = await checkDeviceActivation(INPUT)

    expect(result.licensed).toBe(true)
    // A reintroduced challenge round-trip would show up as a second hit even if
    // the flow still succeeded.
    expect(hits).toEqual(['/vpp-licenses/activate'])
  })
})

/**
 * Scheme-driven module selection is what makes local end-to-end testing possible:
 * `OPENPLC_EDGE_API_URL=http://localhost:3333` must open a PLAIN socket. Sending a
 * TLS ClientHello to it dies with EPROTO, the catch turns that into a generic
 * failure, and the editor silently falls back to demo — so the one contract most
 * worth exercising locally could not be exercised at all.
 */
describe('checkDeviceActivation (base URL scheme)', () => {
  const original = process.env.OPENPLC_EDGE_API_URL

  afterEach(() => {
    if (original === undefined) delete process.env.OPENPLC_EDGE_API_URL
    else process.env.OPENPLC_EDGE_API_URL = original
  })

  it('uses node:http (not https) for an http base URL', async () => {
    process.env.OPENPLC_EDGE_API_URL = 'http://localhost:3333'
    const httpsSpy = jest.spyOn(https, 'request')
    mockResponse(200, { statusCode: 200, data: { licensed: true, license: GOLDEN_B64 } }, http)

    const result = await checkDeviceActivation(INPUT)

    expect(http.request).toHaveBeenCalled()
    expect(httpsSpy).not.toHaveBeenCalled()
    expect(result.licensed).toBe(true)
  })
})
