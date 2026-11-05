/** @jest-environment node */

import type { IncomingMessage } from 'node:http'
import type { RequestOptions } from 'node:https'
import net from 'node:net'

import type { BootloaderApiResult, BootloaderCapabilities } from '../bootloader-api-client'
import { BootloaderApiClient } from '../bootloader-api-client'

const mockRoute: { port: number } = { port: 0 }
const mockHandedTimeouts: Array<number | undefined> = []

jest.mock('https', () => {
  const actual = jest.requireActual<typeof import('https')>('https')
  return {
    ...actual,
    request: (options: RequestOptions, callback?: (res: IncomingMessage) => void) => {
      mockHandedTimeouts.push(options.timeout)
      return actual.request({ ...options, port: mockRoute.port }, callback)
    },
  }
})

type CapabilitiesCall = (
  ipAddress: string,
  options?: { timeoutMs?: number },
) => Promise<BootloaderApiResult<BootloaderCapabilities>>

const hungSockets = new Set<net.Socket>()
const hungServer = net.createServer((socket) => {
  hungSockets.add(socket)
})

let hungPort = 0
let refusedPort = 0

function listen(server: net.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve(typeof address === 'object' && address !== null ? address.port : 0)
    })
  })
}

function close(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

function capabilitiesOf(client: BootloaderApiClient): CapabilitiesCall {
  return client.getCapabilities.bind(client)
}

function optionsWithStringTimeout(timeoutMs: string): { timeoutMs?: number } {
  return Object.defineProperty({}, 'timeoutMs', { value: timeoutMs, enumerable: true })
}

beforeAll(async () => {
  hungPort = await listen(hungServer)
  const released = net.createServer()
  refusedPort = await listen(released)
  await close(released)
})

afterAll(async () => {
  for (const socket of hungSockets) socket.destroy()
  await close(hungServer)
})

beforeEach(() => {
  mockRoute.port = refusedPort
  mockHandedTimeouts.length = 0
})

describe('BootloaderApiClient.getCapabilities timeout', () => {
  it('gives up after 2.5 s when asked for 2,500 ms and the bootloader never answers', async () => {
    mockRoute.port = hungPort
    const startedAt = Date.now()

    const result = await capabilitiesOf(new BootloaderApiClient())('127.0.0.1', { timeoutMs: 2500 })

    expect(result).toEqual({
      success: false,
      error: 'The bootloader on 127.0.0.1:8445 did not respond within 2.5s',
    })
    expect(Date.now() - startedAt).toBeLessThan(4000)
  }, 10_000)

  it.each([500, 2500, 8000])('hands a timeout of %p ms to the request', async (timeoutMs) => {
    const result = await capabilitiesOf(new BootloaderApiClient())('127.0.0.1', { timeoutMs })

    expect(result.success).toBe(false)
    expect(mockHandedTimeouts).toEqual([timeoutMs])
  })

  it('keeps 4,000 ms when no options are given', async () => {
    await capabilitiesOf(new BootloaderApiClient())('127.0.0.1')

    expect(mockHandedTimeouts).toEqual([4000])
  })

  it('keeps 4,000 ms when the options carry no timeout', async () => {
    await capabilitiesOf(new BootloaderApiClient())('127.0.0.1', {})

    expect(mockHandedTimeouts).toEqual([4000])
  })

  it.each([100, 499, 8001, 9000, 2500.5, 0, -2500, Number.NaN, Number.POSITIVE_INFINITY])(
    'keeps 4,000 ms for an out-of-range timeout of %p',
    async (timeoutMs) => {
      await capabilitiesOf(new BootloaderApiClient())('127.0.0.1', { timeoutMs })

      expect(mockHandedTimeouts).toEqual([4000])
    },
  )

  it('keeps 4,000 ms for a timeout given as a string', async () => {
    await capabilitiesOf(new BootloaderApiClient())('127.0.0.1', optionsWithStringTimeout('2500'))

    expect(mockHandedTimeouts).toEqual([4000])
  })
})
