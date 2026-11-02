import { EventEmitter } from 'events'
import http from 'http'
import https from 'https'

import { createRuntimeLicenseMechanisms } from '../runtime-license-mechanisms'

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

const runtimeApiExchange = jest.fn()
const mechanisms = () => createRuntimeLicenseMechanisms({ runtimeApiExchange }, '10.0.0.5')

afterEach(() => {
  jest.restoreAllMocks()
  runtimeApiExchange.mockReset()
  delete process.env.OPENPLC_EDGE_API_URL
})

describe('createRuntimeLicenseMechanisms', () => {
  it('passes runtime GETs and POSTs through the authenticated client, the reply untouched', async () => {
    runtimeApiExchange.mockResolvedValue({ status: 400, body: '{"error":"x"}' })
    await expect(mechanisms().runtimeGet('/api/hardware-id')).resolves.toEqual({ status: 400, body: '{"error":"x"}' })
    await mechanisms().runtimePost('/api/runtime-license', { order_id: 'o1', sig: 's' })
    expect(runtimeApiExchange.mock.calls).toEqual([
      ['GET', '10.0.0.5', '/api/hardware-id'],
      ['POST', '10.0.0.5', '/api/runtime-license', '{"order_id":"o1","sig":"s"}'],
    ])
  })

  it('posts to Edge and returns the raw status and body', async () => {
    const { req, spy } = mockResponse(429, '{"statusCode":429}')
    await expect(mechanisms().edgePost('/runtime-licenses/lookup', { hardwareId: 'hw2:x' })).resolves.toEqual({
      status: 429,
      body: '{"statusCode":429}',
    })
    expect(spy.mock.calls[0][0]).toMatchObject({
      hostname: 'api.autonomylogic.com',
      path: '/runtime-licenses/lookup',
      method: 'POST',
    })
    expect(JSON.parse((req.write.mock.calls[0][0] as Buffer).toString('utf-8'))).toEqual({ hardwareId: 'hw2:x' })
  })

  it('refuses a cleartext Edge URL that is not this machine', async () => {
    process.env.OPENPLC_EDGE_API_URL = 'http://edge.example.com'
    const spy = jest.spyOn(http, 'request')
    await expect(mechanisms().edgePost('/runtime-licenses/lookup', {})).rejects.toThrow()
    expect(spy).not.toHaveBeenCalled()
  })

  it('allows plain http to a local Edge', async () => {
    process.env.OPENPLC_EDGE_API_URL = 'http://localhost:3333'
    mockResponse(200, '{}', http)
    await expect(mechanisms().edgePost('/runtime-licenses/lookup', {})).resolves.toEqual({ status: 200, body: '{}' })
  })
})
