/**
 * The editor refuses to buffer an unbounded device response.
 *
 * Every runtime endpoint but one returns a few hundred bytes of JSON, so the
 * response was simply accumulated. `/api/project-snapshot` breaks that
 * assumption: it hands back the stored archive as base64, which is legitimately
 * large, and a device that returns more than it should -- broken, or not the
 * device we think it is -- could grow that string until the editor runs out of
 * memory. The read is bounded now, and this proves the bound fires and that an
 * ordinary response is unaffected.
 *
 * Driven through a mocked `https` because the behaviour under test is what
 * happens to a stream mid-flight: that the request is torn down rather than
 * read to the end.
 */

import { EventEmitter } from 'events'

const requestMock = jest.fn()
jest.mock('https', () => ({ request: (...args: unknown[]) => requestMock(...args) }))

import { RuntimeApiClient } from '../runtime-api-client'

/** A response that emits `chunks`, and a request that records being destroyed. */
function mockResponse(chunks: Buffer[]) {
  const req = Object.assign(new EventEmitter(), {
    destroyed: false,
    destroy: jest.fn(function (this: { destroyed: boolean }) {
      this.destroyed = true
    }),
    setTimeout: jest.fn(),
    end: jest.fn(),
    write: jest.fn(),
  })

  requestMock.mockImplementation((_options: unknown, handler: (res: EventEmitter) => void) => {
    const res = Object.assign(new EventEmitter(), { statusCode: 200, headers: {} })
    // Deliver after the caller has wired up its listeners.
    setImmediate(() => {
      handler(res)
      for (const chunk of chunks) res.emit('data', chunk)
      res.emit('end')
    })
    return req
  })

  return req
}

/** `httpRequest` is private; the limit is what is under test, not the access. */
function callHttpRequest(client: RuntimeApiClient, maxResponseBytes?: number) {
  return (
    client as unknown as {
      httpRequest(options: {
        method: string
        url: string
        maxResponseBytes?: number
      }): Promise<{ statusCode: number; data: string }>
    }
  ).httpRequest({ method: 'GET', url: 'https://192.168.1.50:8443/api/project-snapshot', maxResponseBytes })
}

beforeEach(() => {
  requestMock.mockReset()
})

it('refuses a response past the limit and tears the request down', async () => {
  // Two chunks of 1 KB against a 1.5 KB limit: the second crosses it.
  const req = mockResponse([Buffer.alloc(1024, 0x61), Buffer.alloc(1024, 0x61)])
  const client = new RuntimeApiClient()

  await expect(callHttpRequest(client, 1536)).rejects.toThrow(/more than this request allows/)

  // Torn down rather than read to the end -- otherwise the bound would only
  // change the error message, not the memory it takes to reach it.
  expect(req.destroy).toHaveBeenCalled()
})

it('accepts a response inside the limit', async () => {
  mockResponse([Buffer.from('{"projectName":"Demo"}')])
  const client = new RuntimeApiClient()

  const result = await callHttpRequest(client, 1024)

  expect(result.statusCode).toBe(200)
  expect(result.data).toBe('{"projectName":"Demo"}')
})

it('leaves every other endpoint unbounded', async () => {
  // The limit is opt-in: the small JSON the rest of the API returns should not
  // have to declare a size to be read.
  mockResponse([Buffer.alloc(64 * 1024, 0x62)])
  const client = new RuntimeApiClient()

  const result = await callHttpRequest(client)

  expect(result.data.length).toBe(64 * 1024)
})
