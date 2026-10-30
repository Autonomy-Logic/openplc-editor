import { EventEmitter } from 'events'
import http from 'http'
import https from 'https'

import {
  lookupRuntimeLicenses,
  MAX_RUNTIME_LICENSE_BYTES,
  RUNTIME_LICENSE_PRODUCT_ID,
  type RuntimeLicenseSyncDeps,
  selectRuntimeLicenseFiles,
  syncRuntimeLicenses,
} from '../runtime-license-sync'

const ID = `hw2:${'ab'.repeat(32)}`
const OTHER_ID = `hw2:${'cd'.repeat(32)}`

function licence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fmt: 1,
    product: RUNTIME_LICENSE_PRODUCT_ID,
    hardware_id: ID,
    seats: 2,
    order_id: 'cmv0a1b2c3d4e5f6g7h8i9j0',
    issued_at: '2026-10-28T12:00:00Z',
    key_id: 0,
    sig: 'c2ln',
    ...overrides,
  }
}

const envelope = (licenses: unknown[]) => ({ statusCode: 200, data: { hardwareId: ID, seats: 2, licenses } })

/** Fake `request` answering `statusCode`/`body`; returns the request so tests can read what was written. */
function mockResponse(statusCode: number, body: string, mod: typeof https | typeof http = https) {
  const req = Object.assign(new EventEmitter(), {
    write: jest.fn(),
    end: jest.fn(),
    setTimeout: jest.fn(),
    destroy: jest.fn(),
  })
  const spy = jest.spyOn(mod, 'request').mockImplementation(((_options: unknown, callback: (res: unknown) => void) => {
    const res = Object.assign(new EventEmitter(), { statusCode, setEncoding: jest.fn() })
    callback(res)
    req.end.mockImplementation(() => {
      res.emit('data', body)
      res.emit('end')
    })
    return req as unknown as ReturnType<typeof https.request>
  }) as typeof https.request)
  return { req, spy }
}

afterEach(() => {
  jest.restoreAllMocks()
  delete process.env.OPENPLC_EDGE_API_URL
})

describe('selectRuntimeLicenseFiles', () => {
  it('keeps licences for this product and hardware ID, as JSON text', () => {
    const files = selectRuntimeLicenseFiles(envelope([licence()]), ID)
    expect(files).toEqual([{ orderId: 'cmv0a1b2c3d4e5f6g7h8i9j0', body: JSON.stringify(licence()) }])
  })

  it('drops licences for another product, another ID, or a bad order ID', () => {
    const files = selectRuntimeLicenseFiles(
      envelope([
        licence({ product: 'com.openplc.espressif-licensed' }),
        licence({ hardware_id: OTHER_ID }),
        licence({ order_id: '../escape' }),
        licence({ order_id: 'x'.repeat(65) }),
        licence({ order_id: 12 }),
        'not an object',
        null,
        [licence()],
      ]),
      ID,
    )
    expect(files).toEqual([])
  })

  it('drops a licence larger than the runtime accepts', () => {
    const big = licence({ sig: 'a'.repeat(MAX_RUNTIME_LICENSE_BYTES) })
    expect(selectRuntimeLicenseFiles(envelope([big]), ID)).toEqual([])
  })

  it('reads an unwrapped body and tolerates junk', () => {
    expect(selectRuntimeLicenseFiles({ licenses: [licence()] }, ID)).toHaveLength(1)
    expect(selectRuntimeLicenseFiles({ statusCode: 200, data: { licenses: 'x' } }, ID)).toEqual([])
    expect(selectRuntimeLicenseFiles(null, ID)).toEqual([])
  })
})

describe('lookupRuntimeLicenses', () => {
  it('posts the hardware ID to the lookup and returns the matching files', async () => {
    const { req, spy } = mockResponse(200, JSON.stringify(envelope([licence()])))
    const result = await lookupRuntimeLicenses(ID)

    expect(result).toEqual({
      ok: true,
      licenses: [{ orderId: 'cmv0a1b2c3d4e5f6g7h8i9j0', body: JSON.stringify(licence()) }],
    })
    const options = spy.mock.calls[0][0] as unknown as { hostname: string; path: string; method: string }
    expect(options).toMatchObject({
      hostname: 'api.autonomylogic.com',
      path: '/runtime-licenses/lookup',
      method: 'POST',
    })
    expect(JSON.parse((req.write.mock.calls[0][0] as Buffer).toString('utf-8'))).toEqual({ hardwareId: ID })
  })

  it('reports a refused lookup (rate limit) without throwing', async () => {
    mockResponse(429, '{"statusCode":429}')
    await expect(lookupRuntimeLicenses(ID)).resolves.toEqual({
      ok: false,
      error: 'The licence server refused the lookup (HTTP 429).',
    })
  })

  it('reports a network failure without throwing', async () => {
    jest.spyOn(https, 'request').mockImplementation((() => {
      const emitter = new EventEmitter()
      const req = Object.assign(emitter, {
        write: jest.fn(),
        setTimeout: jest.fn(),
        destroy: jest.fn(),
        end: jest.fn((): boolean => emitter.emit('error', new Error('getaddrinfo ENOTFOUND'))),
      })
      return req as unknown as ReturnType<typeof https.request>
    }) as typeof https.request)
    await expect(lookupRuntimeLicenses(ID)).resolves.toEqual({ ok: false, error: 'getaddrinfo ENOTFOUND' })
  })

  it('never sends a malformed ID', async () => {
    const spy = jest.spyOn(https, 'request')
    await expect(lookupRuntimeLicenses('hw2:nope')).resolves.toEqual({ ok: false, error: 'Not a hardware ID.' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('refuses a cleartext Edge URL that is not this machine', async () => {
    process.env.OPENPLC_EDGE_API_URL = 'http://edge.example.com'
    const spy = jest.spyOn(http, 'request')
    const result = await lookupRuntimeLicenses(ID)
    expect(result.ok).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })

  it('allows plain http to a local Edge', async () => {
    process.env.OPENPLC_EDGE_API_URL = 'http://localhost:3333'
    mockResponse(200, JSON.stringify(envelope([])), http)
    await expect(lookupRuntimeLicenses(ID)).resolves.toEqual({ ok: true, licenses: [] })
  })
})

describe('syncRuntimeLicenses', () => {
  function deps(overrides: Partial<RuntimeLicenseSyncDeps> = {}): RuntimeLicenseSyncDeps {
    return {
      getHardwareId: jest.fn().mockResolvedValue({ success: true, hardwareId: ID, source: 'device' }),
      lookup: jest.fn().mockResolvedValue({
        ok: true,
        licenses: [
          { orderId: 'order_1', body: '{"a":1}' },
          { orderId: 'order_2', body: '{"b":2}' },
        ],
      }),
      upload: jest.fn().mockResolvedValue({ stored: true }),
      ...overrides,
    }
  }

  it('uploads every licence Edge returns for the runtime ID', async () => {
    const d = deps({
      upload: jest
        .fn()
        .mockResolvedValueOnce({ stored: true })
        .mockResolvedValueOnce({ stored: false, error: 'Licence is for another hardware ID' }),
    })
    await expect(syncRuntimeLicenses(d)).resolves.toEqual({
      status: 'synced',
      hardwareId: ID,
      uploads: [
        { orderId: 'order_1', stored: true },
        { orderId: 'order_2', stored: false, error: 'Licence is for another hardware ID' },
      ],
    })
    expect(d.lookup).toHaveBeenCalledWith(ID)
    expect(d.upload).toHaveBeenNthCalledWith(1, '{"a":1}')
    expect(d.upload).toHaveBeenNthCalledWith(2, '{"b":2}')
  })

  it('does nothing past the runtime when it has no hardware ID', async () => {
    const d = deps({ getHardwareId: jest.fn().mockResolvedValue({ success: true, hardwareId: null, source: null }) })
    await expect(syncRuntimeLicenses(d)).resolves.toEqual({ status: 'no-hardware-id' })
    expect(d.lookup).not.toHaveBeenCalled()
  })

  it('reports a failed hardware ID read or lookup and uploads nothing', async () => {
    const noId = deps({ getHardwareId: jest.fn().mockResolvedValue({ success: false, error: 'HTTP 404' }) })
    await expect(syncRuntimeLicenses(noId)).resolves.toEqual({ status: 'failed', error: 'HTTP 404' })

    const offline = deps({ lookup: jest.fn().mockResolvedValue({ ok: false, error: 'offline' }) })
    await expect(syncRuntimeLicenses(offline)).resolves.toEqual({ status: 'failed', error: 'offline' })
    expect(offline.upload).not.toHaveBeenCalled()
  })

  it('turns a thrown dependency into a failure', async () => {
    const d = deps({ upload: jest.fn().mockRejectedValue(new Error('socket hang up')) })
    await expect(syncRuntimeLicenses(d)).resolves.toEqual({ status: 'failed', error: 'socket hang up' })
  })
})
