/** @jest-environment node */

import { execFileSync } from 'node:child_process'
import { createHash, X509Certificate } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer as createHttpsServer, type Server } from 'node:https'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as createTlsServer, type TLSSocket } from 'node:tls'

import { connectPinnedRuntime, pinnedRuntimeRequest, RuntimeIdentityError } from '../pinned-runtime-request'

const SECRET = 'MARKER-PW-e5-pinned-77d1'
const JWT = 'MARKER-JWT-e5-pinned-1f0c'

interface Identity {
  key: string
  cert: string
  sha256: string
}

let workdir = ''

/** Same shape as the runtime's own certificate: self-signed, CN/SAN localhost and 127.0.0.1. */
const makeIdentity = (name: string): Identity => {
  const key = join(workdir, `${name}.key`)
  const cert = join(workdir, `${name}.crt`)
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '2',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ],
    { stdio: 'ignore' },
  )
  const pem = readFileSync(cert, 'utf-8')
  const sha256 = createHash('sha256')
    .update(new Uint8Array(new X509Certificate(pem).raw))
    .digest('hex')
  return { key: readFileSync(key, 'utf-8'), cert: pem, sha256 }
}

let runtime: Identity
let impostor: Identity

interface Recorded {
  requests: Array<{ method: string; url: string; authorization: string; body: string }>
  server: Server
  port: number
}

const startRuntime = async (identity: Identity, options: { maxVersion?: 'TLSv1.1' } = {}): Promise<Recorded> => {
  const recorded: Recorded = { requests: [], server: createHttpsServer(), port: 0 }
  recorded.server = createHttpsServer(
    {
      key: identity.key,
      cert: identity.cert,
      ...(options.maxVersion
        ? { maxVersion: options.maxVersion, minVersion: 'TLSv1', ciphers: 'DEFAULT@SECLEVEL=0' }
        : {}),
    },
    (req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        recorded.requests.push({
          method: req.method ?? '',
          url: req.url ?? '',
          authorization: req.headers.authorization ?? '',
          body: Buffer.concat(chunks.map((c) => new Uint8Array(c))).toString('utf-8'),
        })
        if (req.url === '/big') {
          res.end('x'.repeat(4096))
          return
        }
        res.writeHead(201, { 'Content-Type': 'application/json' })
        res.end('{"ok":true}')
      })
    },
  )
  await new Promise<void>((resolve) => recorded.server.listen(0, '127.0.0.1', resolve))
  recorded.port = (recorded.server.address() as AddressInfo).port
  return recorded
}

const close = (server: { close: (cb: () => void) => void }) =>
  new Promise<void>((resolve) => server.close(() => resolve()))

beforeAll(() => {
  workdir = mkdtempSync(join(tmpdir(), 'pinned-runtime-'))
  runtime = makeIdentity('runtime')
  impostor = makeIdentity('impostor')
})

afterAll(() => {
  rmSync(workdir, { recursive: true, force: true })
})

describe('pinnedRuntimeRequest', () => {
  it('reaches the pinned runtime by IP and delivers headers and body', async () => {
    const server = await startRuntime(runtime)
    try {
      const response = await pinnedRuntimeRequest({
        host: '127.0.0.1',
        port: server.port,
        sha256: runtime.sha256,
        method: 'POST',
        path: '/api/mqtt/credentials/staging',
        headers: { Authorization: `Bearer ${JWT}`, 'Content-Type': 'text/plain' },
        body: Buffer.from(SECRET),
        timeoutMs: 5000,
        maxResponseBytes: 1024,
      })
      expect(response).toEqual({ statusCode: 201, body: '{"ok":true}' })
      expect(server.requests).toEqual([
        { method: 'POST', url: '/api/mqtt/credentials/staging', authorization: `Bearer ${JWT}`, body: SECRET },
      ])
    } finally {
      await close(server.server)
    }
  })

  it('sends nothing to a server whose certificate does not match the pin, even with the same names', async () => {
    const received: Buffer[] = []
    const server = createTlsServer({ key: impostor.key, cert: impostor.cert }, (socket: TLSSocket) => {
      socket.on('data', (chunk: Buffer) => received.push(chunk))
      socket.on('error', () => undefined)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    try {
      const outcome = pinnedRuntimeRequest({
        host: '127.0.0.1',
        port,
        sha256: runtime.sha256,
        method: 'POST',
        path: '/api/mqtt/credentials/staging',
        headers: { Authorization: `Bearer ${JWT}` },
        body: Buffer.from(SECRET),
        timeoutMs: 5000,
        maxResponseBytes: 1024,
      })
      await expect(outcome).rejects.toBeInstanceOf(RuntimeIdentityError)
      await expect(outcome).rejects.toMatchObject({ code: 'runtime_identity_mismatch' })
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(Buffer.concat(received.map((c) => new Uint8Array(c))).length).toBe(0)
    } finally {
      await close(server)
    }
  })

  it('accepts the impostor only as a negative control, when its own fingerprint is pinned', async () => {
    const server = await startRuntime(impostor)
    try {
      const response = await pinnedRuntimeRequest({
        host: '127.0.0.1',
        port: server.port,
        sha256: impostor.sha256,
        method: 'GET',
        path: '/ping',
        timeoutMs: 5000,
        maxResponseBytes: 1024,
      })
      expect(response.statusCode).toBe(201)
    } finally {
      await close(server.server)
    }
  })

  it('refuses a malformed pin without opening a connection', async () => {
    const connect = jest.fn()
    await expect(
      connectPinnedRuntime({ host: '127.0.0.1', port: 1, sha256: 'AB:CD', timeoutMs: 100 }, connect),
    ).rejects.toMatchObject({ code: 'runtime_trust_missing' })
    expect(connect).not.toHaveBeenCalled()
  })

  it('refuses a runtime that only speaks TLS 1.1', async () => {
    const server = await startRuntime(runtime, { maxVersion: 'TLSv1.1' })
    try {
      await expect(
        pinnedRuntimeRequest({
          host: '127.0.0.1',
          port: server.port,
          sha256: runtime.sha256,
          method: 'GET',
          path: '/ping',
          timeoutMs: 5000,
          maxResponseBytes: 1024,
        }),
      ).rejects.toThrow()
      expect(server.requests).toEqual([])
    } finally {
      await close(server.server)
    }
  })

  it('stops reading a response larger than allowed', async () => {
    const server = await startRuntime(runtime)
    try {
      await expect(
        pinnedRuntimeRequest({
          host: '127.0.0.1',
          port: server.port,
          sha256: runtime.sha256,
          method: 'GET',
          path: '/big',
          timeoutMs: 5000,
          maxResponseBytes: 100,
        }),
      ).rejects.toThrow('more than 100 bytes')
    } finally {
      await close(server.server)
    }
  })

  it('gives up on a peer that never completes the handshake', async () => {
    const sockets: Array<{ destroy: () => void }> = []
    const tcp = (await import('node:net')).createServer((socket) => sockets.push(socket))
    await new Promise<void>((resolve) => tcp.listen(0, '127.0.0.1', resolve))
    const { port } = tcp.address() as AddressInfo
    try {
      await expect(
        connectPinnedRuntime({ host: '127.0.0.1', port, sha256: runtime.sha256, timeoutMs: 200 }),
      ).rejects.toThrow('Connection timeout')
    } finally {
      for (const socket of sockets) socket.destroy()
      await close(tcp)
    }
  })
})
