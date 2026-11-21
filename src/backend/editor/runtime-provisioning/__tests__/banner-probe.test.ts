/** @jest-environment node */

import type { Socket } from 'node:net'

import { createRuntimeProvisioningService } from '../../../shared/runtime-provisioning/service'
import { createFakeDevice } from '../../../shared/runtime-provisioning/__tests__/fixtures/in-memory-mechanisms'
import { createBannerProbeMechanism } from '../banner-probe'
import type { RawServer } from './fixtures/local-servers'
import { LOOPBACK, OPENSSH_GREETING, receivedByteCount, refusedPort, startRawServer } from './fixtures/local-servers'

const LONG_TIMEOUT_MS = 10_000
const SHORT_TIMEOUT_MS = 100
const MAX_BYTES = 1024

const servers: RawServer[] = []

async function serve(onConnection: (socket: Socket) => void): Promise<RawServer> {
  const server = await startRawServer(onConnection)
  servers.push(server)
  return server
}

function keepOpen(): void {}

function read(port: number, timeoutMs = LONG_TIMEOUT_MS, maxBytes = MAX_BYTES) {
  return createBannerProbeMechanism().read({ host: LOOPBACK, port, timeoutMs, maxBytes })
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()))
})

describe('the SSH banner probe mechanism', () => {
  it('returns the greeting line as soon as it is complete, sending no byte, then closes (AS-16)', async () => {
    const server = await serve((socket) => socket.write(OPENSSH_GREETING))

    await expect(read(server.port)).resolves.toEqual({ kind: 'data', text: OPENSSH_GREETING })

    const connection = await server.firstConnection()
    await connection.closed
    expect(receivedByteCount(connection)).toBe(0)
  })

  it('collects a greeting split over two writes into one line', async () => {
    const server = await serve((socket) => {
      socket.write('SSH-2.0-Open', () => setImmediate(() => socket.write('SSH_9.2p1\r\n')))
    })

    await expect(read(server.port)).resolves.toEqual({ kind: 'data', text: OPENSSH_GREETING })
  })

  it('decodes the bytes as latin1', async () => {
    const server = await serve((socket) => socket.write('SSH-2.0-caf\xe9\r\n', 'latin1'))

    await expect(read(server.port)).resolves.toEqual({ kind: 'data', text: 'SSH-2.0-café\r\n' })
  })

  it('returns what a non-SSH service sent, unchanged', async () => {
    const server = await serve((socket) => socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'))

    await expect(read(server.port)).resolves.toEqual({ kind: 'data', text: 'HTTP/1.1 400 Bad Request\r\n\r\n' })
  })

  it('returns the partial data when the server closes before a complete line', async () => {
    const server = await serve((socket) => socket.end('SSH-2.0-partial'))

    await expect(read(server.port)).resolves.toEqual({ kind: 'data', text: 'SSH-2.0-partial' })
  })

  it('returns empty data when the server closes without sending anything', async () => {
    const server = await serve((socket) => socket.end())

    await expect(read(server.port)).resolves.toEqual({ kind: 'data', text: '' })
  })

  it('stops reading at the byte limit without waiting for a line, the close or the timeout', async () => {
    const server = await serve((socket) => socket.write('x'.repeat(4 * MAX_BYTES)))

    const result = await read(server.port)

    expect(result.kind === 'data' ? result.text.length : 0).toBeGreaterThanOrEqual(MAX_BYTES)
    expect(result.kind === 'data' ? /^x+$/.test(result.text) : false).toBe(true)
    const connection = await server.firstConnection()
    await connection.closed
    expect(receivedByteCount(connection)).toBe(0)
  })

  it('reports a refused connection with its code, not as a timeout', async () => {
    const port = await refusedPort()

    await expect(read(port)).resolves.toEqual({ kind: 'error', code: 'ECONNREFUSED', timedOut: false })
  })

  it('reports a silent server as timed out and closes the connection, sending no byte', async () => {
    const server = await serve(keepOpen)

    const result = await read(server.port, SHORT_TIMEOUT_MS)

    expect(result).toEqual(expect.objectContaining({ kind: 'error', timedOut: true }))
    const connection = await server.firstConnection()
    await connection.closed
    expect(receivedByteCount(connection)).toBe(0)
  })
})

describe('the probe through the shared service with the real banner mechanism (AS-16)', () => {
  function probe(port: number) {
    const device = createFakeDevice()
    const service = createRuntimeProvisioningService({
      ...device.mechanisms,
      bannerProbe: createBannerProbeMechanism(),
    })
    return service.probeSsh({ host: LOOPBACK, port })
  }

  it('answers for an SSH greeting, and the SSH port received no byte before the socket closed', async () => {
    const server = await serve((socket) => socket.write(OPENSSH_GREETING))

    await expect(probe(server.port)).resolves.toEqual({ answered: true })

    const connection = await server.firstConnection()
    await connection.closed
    expect(receivedByteCount(connection)).toBe(0)
    expect(server.connections).toHaveLength(1)
  })

  it('reports an HTTP answer as not SSH', async () => {
    const server = await serve((socket) => socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'))

    await expect(probe(server.port)).resolves.toEqual({ answered: false, reason: 'not-ssh' })
  })

  it('reports a closed port as refused', async () => {
    const port = await refusedPort()

    await expect(probe(port)).resolves.toEqual({ answered: false, reason: 'refused' })
  })
})
