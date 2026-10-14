// The pin is checked before the socket reaches the HTTP request, so a wrong peer never gets the JWT or body.

import { timingSafeEqual } from 'crypto'
import type { IncomingMessage } from 'http'
import https from 'https'
import { isIP } from 'net'
import tls from 'tls'

export type RuntimeIdentityErrorCode = 'runtime_trust_missing' | 'runtime_identity_mismatch'

export class RuntimeIdentityError extends Error {
  constructor(
    readonly code: RuntimeIdentityErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'RuntimeIdentityError'
  }
}

export interface PinnedRuntimeRequest {
  host: string
  port: number
  /** Lowercase hex SHA-256 of the runtime's DER certificate. */
  sha256: string
  method: 'GET' | 'POST' | 'DELETE'
  path: string
  headers?: Record<string, string | number>
  body?: Buffer
  timeoutMs: number
  maxResponseBytes: number
}

export interface PinnedRuntimeResponse {
  statusCode: number
  body: string
}

type TlsConnect = (options: tls.ConnectionOptions) => tls.TLSSocket

const asBytes = (buffer: Buffer): Uint8Array => new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)

const sameDigest = (expected: string, presented: string | undefined): boolean => {
  if (presented === undefined) return false
  const actual = asBytes(Buffer.from(presented.replace(/:/g, '').toLowerCase(), 'utf-8'))
  const wanted = asBytes(Buffer.from(expected, 'utf-8'))
  return actual.length === wanted.length && timingSafeEqual(actual, wanted)
}

/** A TLS socket to `host:port` whose certificate matches `sha256`; rejects without sending anything otherwise. */
export const connectPinnedRuntime = (
  request: Pick<PinnedRuntimeRequest, 'host' | 'port' | 'sha256' | 'timeoutMs'>,
  connect: TlsConnect = tls.connect,
): Promise<tls.TLSSocket> =>
  new Promise((resolve, reject) => {
    if (!/^[0-9a-f]{64}$/.test(request.sha256)) {
      reject(new RuntimeIdentityError('runtime_trust_missing', 'No trusted certificate fingerprint for this runtime.'))
      return
    }
    const socket = connect({
      host: request.host,
      port: request.port,
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2',
      ...(isIP(request.host) === 0 ? { servername: request.host } : {}),
    })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('Connection timeout'))
    }, request.timeoutMs)
    socket.once('secureConnect', () => {
      clearTimeout(timer)
      if (!sameDigest(request.sha256, socket.getPeerCertificate()?.fingerprint256)) {
        socket.destroy()
        reject(
          new RuntimeIdentityError(
            'runtime_identity_mismatch',
            'The runtime certificate does not match the trusted fingerprint; nothing was sent.',
          ),
        )
        return
      }
      resolve(socket)
    })
    socket.once('error', (error: Error) => {
      clearTimeout(timer)
      reject(error)
    })
  })

/** One request over a pinned connection. Network and identity failures reject; any HTTP status resolves. */
export const pinnedRuntimeRequest = async (
  request: PinnedRuntimeRequest,
  connect: TlsConnect = tls.connect,
): Promise<PinnedRuntimeResponse> => {
  const socket = await connectPinnedRuntime(request, connect)
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: request.host,
        port: request.port,
        method: request.method,
        path: request.path,
        headers: {
          ...request.headers,
          ...(request.body ? { 'Content-Length': request.body.length } : {}),
        },
        createConnection: () => socket,
      },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = []
        let received = 0
        res.on('data', (chunk: Buffer) => {
          received += chunk.length
          if (received > request.maxResponseBytes) {
            req.destroy()
            reject(new Error(`The runtime sent more than ${request.maxResponseBytes} bytes.`))
            return
          }
          chunks.push(chunk)
        })
        res.on('end', () => {
          resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks.map(asBytes)).toString('utf-8') })
        })
        res.on('error', reject)
      },
    )
    req.setTimeout(request.timeoutMs, () => {
      req.destroy()
      reject(new Error('Connection timeout'))
    })
    req.on('error', reject)
    if (request.body) req.write(request.body)
    req.end()
  })
}
