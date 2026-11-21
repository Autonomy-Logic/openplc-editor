import { mkdtempSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { AuthContext, Connection, ServerChannel } from 'ssh2'
import { Server, utils } from 'ssh2'

export const LOOPBACK = '127.0.0.1'
export const SERVER_USERNAME = 'commissioner42'
export const SERVER_PASSWORD = 'S3cr3t-Pi!'
export const OPENSSH_GREETING = 'SSH-2.0-OpenSSH_9.2p1\r\n'

export function temporaryFolder(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix))
}

export function listenOn(server: net.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, LOOPBACK, () => {
      const address = server.address()
      resolve(typeof address === 'object' && address !== null ? address.port : 0)
    })
  })
}

export function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

export async function refusedPort(): Promise<number> {
  const released = net.createServer()
  const port = await listenOn(released)
  await closeServer(released)
  return port
}

export interface RawConnection {
  socket: net.Socket
  received: Uint8Array[]
  closed: Promise<void>
}

export interface RawServer {
  port: number
  connections: RawConnection[]
  firstConnection(): Promise<RawConnection>
  stop(): Promise<void>
}

export async function startRawServer(onConnection: (socket: net.Socket) => void): Promise<RawServer> {
  const connections: RawConnection[] = []
  const waiting: ((connection: RawConnection) => void)[] = []
  const server = net.createServer((socket) => {
    const received: Uint8Array[] = []
    socket.on('data', (chunk: Uint8Array) => received.push(chunk))
    socket.on('error', () => undefined)
    const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()))
    const connection: RawConnection = { socket, received, closed }
    connections.push(connection)
    waiting.splice(0).forEach((notify) => notify(connection))
    onConnection(socket)
  })
  const port = await listenOn(server)
  return {
    port,
    connections,
    firstConnection: () => {
      const first = connections.at(0)
      return first !== undefined
        ? Promise.resolve(first)
        : new Promise<RawConnection>((resolve) => waiting.push(resolve))
    },
    stop: async () => {
      connections.forEach((connection) => connection.socket.destroy())
      await closeServer(server)
    },
  }
}

export interface FreezableProxy {
  port: number
  freeze(): void
  stop(): Promise<void>
}

/** Loopback TCP proxy that forwards both ways until frozen, then reads and drops everything without closing. */
export async function startFreezableProxy(targetPort: number): Promise<FreezableProxy> {
  let frozen = false
  const sockets: net.Socket[] = []
  const server = net.createServer({ allowHalfOpen: true }, (client) => {
    const upstream = net.connect({ port: targetPort, host: LOOPBACK, allowHalfOpen: true })
    sockets.push(client, upstream)
    for (const socket of [client, upstream]) socket.on('error', () => undefined)
    client.on('data', (chunk: Uint8Array) => {
      if (!frozen) upstream.write(chunk)
    })
    upstream.on('data', (chunk: Uint8Array) => {
      if (!frozen) client.write(chunk)
    })
    client.on('end', () => {
      if (!frozen) upstream.end()
    })
    upstream.on('end', () => {
      if (!frozen) client.end()
    })
  })
  const port = await listenOn(server)
  return {
    port,
    freeze: () => {
      frozen = true
    },
    stop: async () => {
      sockets.forEach((socket) => socket.destroy())
      await closeServer(server)
    },
  }
}

export function receivedByteCount(connection: RawConnection): number {
  return connection.received.reduce((total, chunk) => total + chunk.length, 0)
}

export interface HostKeyPair {
  privateKey: string
  keyType: string
  publicBlob: string
}

function toHostKeyPair(pair: { private: string; public: string }): HostKeyPair {
  const [keyType = '', publicBlob = ''] = pair.public.split(' ')
  return { privateKey: pair.private, keyType, publicBlob }
}

export function ed25519HostKey(): HostKeyPair {
  for (;;) {
    const pair = utils.generateKeyPairSync('ed25519')
    if (!(utils.parseKey(pair.private) instanceof Error)) return toHostKeyPair(pair)
  }
}

export function ecdsaHostKey(): HostKeyPair {
  return toHostKeyPair(utils.generateKeyPairSync('ecdsa', { bits: 256 }))
}

export interface AuthAttempt {
  method: string
  username: string
  password?: string
}

export type ExecBehaviour = (command: string, channel: ServerChannel) => void

export interface SshServerBehaviour {
  hostKey?: HostKeyPair
  authenticate?: (context: AuthContext) => void
  beforeAuthentication?: (attempt: AuthAttempt) => void
  exec?: ExecBehaviour
}

export interface TestSshServer {
  port: number
  hostKey: HostKeyPair
  authAttempts: AuthAttempt[]
  commands: string[]
  connectionCount(): number
  firstClientGone(): Promise<void>
  dropClients(): void
  stop(): Promise<void>
}

export function passwordOnly(context: AuthContext): void {
  if (context.method === 'password' && context.username === SERVER_USERNAME && context.password === SERVER_PASSWORD) {
    context.accept()
    return
  }
  context.reject(['password'])
}

export function publicKeyOnly(context: AuthContext): void {
  context.reject(['publickey'])
}

export const HANG_COMMAND = 'hang'

/** Answers every command with its name and exit code 0, except `hang`, which is accepted and never ended. */
export function hangOrAnswer(onHang: (channel: ServerChannel) => void = () => undefined): ExecBehaviour {
  return (command, channel) => {
    if (command === HANG_COMMAND) {
      onHang(channel)
      return
    }
    channel.write(`ran ${command}`)
    channel.exit(0)
    channel.end()
  }
}

export const unreadableProbe: ExecBehaviour = (_command, channel) => {
  channel.write('garbage\n')
  channel.exit(0)
  channel.end()
}

function attemptOf(context: AuthContext): AuthAttempt {
  if (context.method === 'password') {
    return { method: context.method, username: context.username, password: context.password }
  }
  return { method: context.method, username: context.username }
}

export async function startSshServer(behaviour: SshServerBehaviour = {}): Promise<TestSshServer> {
  const hostKey = behaviour.hostKey ?? ed25519HostKey()
  const authenticate = behaviour.authenticate ?? passwordOnly
  const exec = behaviour.exec ?? unreadableProbe
  const authAttempts: AuthAttempt[] = []
  const commands: string[] = []
  const clients: Connection[] = []
  const gone: Promise<void>[] = []
  const server = new Server({ hostKeys: [hostKey.privateKey] }, (client) => {
    clients.push(client)
    gone.push(new Promise((resolve) => client.once('close', () => resolve())))
    client.on('error', () => undefined)
    client.on('authentication', (context) => {
      const attempt = attemptOf(context)
      authAttempts.push(attempt)
      behaviour.beforeAuthentication?.(attempt)
      authenticate(context)
    })
    client.on('ready', () => {
      client.on('session', (acceptSession) => {
        const session = acceptSession()
        session.on('exec', (acceptExec, _rejectExec, info) => {
          commands.push(info.command)
          exec(info.command, acceptExec())
        })
      })
    })
  })
  const port = await listenOn(server)
  return {
    port,
    hostKey,
    authAttempts,
    commands,
    connectionCount: () => clients.length,
    firstClientGone: () => gone.at(0) ?? Promise.reject(new Error('no client connected')),
    dropClients: () => clients.forEach((client) => client.end()),
    stop: async () => {
      clients.forEach((client) => client.end())
      await closeServer(server)
    },
  }
}
