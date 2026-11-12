import { lookup } from 'node:dns/promises'
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
import { createConnection, createServer as createNetServer, type Server as NetServer, type Socket } from 'node:net'

import { generate } from 'selfsigned'
import { type AuthContext, type Connection, Server as SshServer, type ServerChannel, utils } from 'ssh2'

export const PROVISIONING_HOST = process.env.E2E_PROVISIONING_HOST ?? 'ip6-localhost'

export const DEVICE_USER = 'commissioner42'

export const DEVICE_PASSWORD = 'S3cr3t-Pi!'

export const INSTALLER_DIR = '/tmp/openplc-e2e-installer'

export type CommandKind =
  | 'probe-system'
  | 'privilege-check'
  | 'inspect-runtime'
  | 'start-native-service'
  | 'restart-bootloader'
  | 'start-other'
  | 'prepare-installer'
  | 'start-installer'
  | 'poll-installer'
  | 'docker-present'
  | 'unknown'

/** One SSH exec request the fake device received, with what the client wrote on its stdin. */
export interface ExecRecord {
  kind: CommandKind
  command: string
  stdin: string
}

/** One TCP connection to the fake SSH port: bytes the client sent and its authentication attempts. */
export interface ConnectionRecord {
  clientBytes: number
  authAttempts: { method: string; username: string }[]
}

/** What the fake device answers to the inspection commands. */
export interface DeviceProfile {
  arch: { dpkgArch: string; machine: string; longBit: string }
  download: 'ok' | 'failed'
  uid: string
  sudo: boolean
  passwordLogin: boolean
  runtime: { docker: string; bootloader: string; runtimeContainer: string; native: string; v3: string }
  onStartCommand: () => Promise<void>
}

/** An installer whose log and exit the test drives by hand. */
export interface FakeInstaller {
  started: Promise<void>
  write(line: string): void
  finish(code: number): void
}

/** A Linux device on the loopback that answers SSH like a fresh device, scripted per test. */
export interface FakeDevice {
  address: string
  sshPort: number
  hostKeyBase64: string
  connections: ConnectionRecord[]
  execs: ExecRecord[]
  installer: FakeInstaller
  holdNext(kind: CommandKind): () => void
  dropConnections(): void
  close(): Promise<void>
}

/** A fake runtime or bootloader HTTPS endpoint and the requests it served. */
export interface FakeHttpsEndpoint {
  paths: string[]
  close(): Promise<void>
}

const NO_RUNTIME: DeviceProfile['runtime'] = {
  docker: 'absent',
  bootloader: 'absent',
  runtimeContainer: 'absent',
  native: 'absent',
  v3: 'none',
}

/** A non-root sudo account on a device with no runtime installed. */
export function freshDeviceProfile(overrides: Partial<DeviceProfile> = {}): DeviceProfile {
  return {
    arch: { dpkgArch: 'arm64', machine: 'aarch64', longBit: '64' },
    download: 'ok',
    uid: '1000',
    sudo: true,
    passwordLogin: true,
    runtime: NO_RUNTIME,
    onStartCommand: () => Promise.resolve(),
    ...overrides,
  }
}

/** The loopback address the provisioning host name resolves to. */
export async function provisioningAddress(): Promise<string> {
  return (await lookup(PROVISIONING_HOST)).address
}

/** Classifies a command by the shell fragments each provisioning step is made of. */
export function commandKind(command: string): CommandKind {
  if (command.includes('uname -s')) return 'probe-system'
  if (command.includes('bootloader=$b')) return 'inspect-runtime'
  if (command.includes('mktemp -d')) return 'prepare-installer'
  if (command.includes('setsid sh -c')) return 'start-installer'
  if (command.includes('exit=%s')) return 'poll-installer'
  if (command.includes('command -v docker') && command.includes('docker=yes')) return 'docker-present'
  if (command.includes('systemctl start openplc-runtime.service')) return 'start-native-service'
  if (command.includes('docker restart openplc-bootloader')) return 'restart-bootloader'
  if (command.includes('docker start') || command.includes('systemctl start')) return 'start-other'
  if (command.endsWith("/bin/true'") || command.endsWith('/bin/true')) return 'privilege-check'
  return 'unknown'
}

/** Whether a TCP connection to the port is accepted. */
export function portAnswers(address: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: address, port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

function sudoAccepted(stdin: string, profile: DeviceProfile): boolean {
  return profile.sudo && stdin === `${DEVICE_PASSWORD}\n`
}

function runtimeLines(profile: DeviceProfile): string {
  const { docker, bootloader, runtimeContainer, native, v3 } = profile.runtime
  return `docker=${docker}\nbootloader=${bootloader}\nruntime_container=${runtimeContainer}\nnative=${native}\nv3=${v3}\n`
}

function pollOffset(command: string): number {
  const match = /f=(\d+);/.exec(command)
  return match === null ? 0 : Number(match[1])
}

interface ScriptedInstaller extends FakeInstaller {
  log: string
  exitCode: number | null
  markStarted(): void
}

function createInstaller(): ScriptedInstaller {
  let markStarted = (): void => undefined
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  const installer: ScriptedInstaller = {
    log: '',
    exitCode: null,
    started,
    markStarted: () => markStarted(),
    write(line: string) {
      installer.log += `${line}\n`
    },
    finish(code: number) {
      installer.exitCode = code
    },
  }
  return installer
}

function answer(stream: ServerChannel, stdout: string, code: number): void {
  if (stdout !== '') stream.write(stdout)
  stream.exit(code)
  stream.end()
}

/** Starts a fake SSH device on the provisioning address, on a free port. */
export async function startFakeDevice(profile: DeviceProfile): Promise<FakeDevice> {
  const address = await provisioningAddress()
  const hostKey = utils.generateKeyPairSync('ecdsa', { bits: 256 })
  const parsedKey = utils.parseKey(hostKey.private)
  if (parsedKey instanceof Error) throw parsedKey
  const hostKeyBase64 = parsedKey.getPublicSSH().toString('base64')
  const connections: ConnectionRecord[] = []
  const execs: ExecRecord[] = []
  const installer = createInstaller()
  const held = new Map<CommandKind, Promise<void>>()
  const openSockets = new Set<Socket>()

  const respond = async (stream: ServerChannel, record: ExecRecord): Promise<void> => {
    const hold = held.get(record.kind)
    if (hold !== undefined) {
      held.delete(record.kind)
      await hold
    }
    const elevated = record.command.startsWith('/usr/bin/sudo ')
    if (elevated && !sudoAccepted(record.stdin, profile)) return answer(stream, '', 1)
    switch (record.kind) {
      case 'probe-system':
        return answer(
          stream,
          `os=Linux\nsystemd=yes\ndpkg_arch=${profile.arch.dpkgArch}\nmachine=${profile.arch.machine}\n` +
            `long_bit=${profile.arch.longBit}\nuid=${profile.uid}\n`,
          0,
        )
      case 'privilege-check':
        return answer(stream, '', 0)
      case 'inspect-runtime':
        return answer(stream, runtimeLines(profile), 0)
      case 'start-native-service':
      case 'restart-bootloader':
      case 'start-other':
        await profile.onStartCommand()
        return answer(stream, '', 0)
      case 'prepare-installer':
        return answer(stream, `dir=${INSTALLER_DIR}\ndownload=${profile.download}\n`, 0)
      case 'start-installer':
        installer.markStarted()
        return answer(stream, '', 0)
      case 'poll-installer': {
        const from = pollOffset(record.command)
        const exit = installer.exitCode === null ? 'running' : String(installer.exitCode)
        const size = Buffer.byteLength(installer.log)
        const body = Buffer.from(installer.log).subarray(from).toString()
        return answer(stream, `exit=${exit}\nsize=${size}\nfrom=${from}\n---\n${body}`, 0)
      }
      case 'docker-present':
        return answer(stream, 'docker=no\n', 0)
      case 'unknown':
        return answer(stream, '', 127)
    }
  }

  const onClient = (client: Connection, record: ConnectionRecord): void => {
    client.on('error', () => undefined)
    client.on('authentication', (ctx: AuthContext) => {
      record.authAttempts.push({ method: ctx.method, username: ctx.username })
      if (!profile.passwordLogin) return ctx.reject(['publickey'])
      if (ctx.method === 'password' && ctx.username === DEVICE_USER && ctx.password === DEVICE_PASSWORD)
        return ctx.accept()
      return ctx.reject(['password'])
    })
    client.on('ready', () => {
      client.on('session', (acceptSession) => {
        const session = acceptSession()
        session.on('exec', (acceptExec, _reject, info) => {
          const stream = acceptExec()
          const exec: ExecRecord = { kind: commandKind(info.command), command: info.command, stdin: '' }
          execs.push(exec)
          stream.on('data', (chunk: Buffer) => {
            exec.stdin += chunk.toString()
          })
          stream.on('error', () => undefined)
          stream.once('end', () => void respond(stream, exec))
        })
      })
    })
  }

  const front: NetServer = createNetServer((socket) => {
    const record: ConnectionRecord = { clientBytes: 0, authAttempts: [] }
    connections.push(record)
    openSockets.add(socket)
    socket.on('data', (chunk: Buffer) => {
      record.clientBytes += chunk.length
    })
    socket.on('error', () => undefined)
    socket.on('close', () => openSockets.delete(socket))
    const ssh = new SshServer({ hostKeys: [hostKey.private] })
    ssh.on('connection', (client) => onClient(client, record))
    ssh.on('error', () => undefined)
    ssh.injectSocket(socket)
  })
  await new Promise<void>((resolve) => front.listen(0, address, resolve))
  const bound = front.address()
  if (bound === null || typeof bound === 'string') throw new Error('the fake SSH device has no TCP port')

  return {
    address,
    sshPort: bound.port,
    hostKeyBase64,
    connections,
    execs,
    installer,
    holdNext(kind) {
      let release = (): void => undefined
      held.set(
        kind,
        new Promise<void>((resolve) => {
          release = resolve
        }),
      )
      return () => release()
    },
    dropConnections() {
      for (const socket of openSockets) socket.destroy()
    },
    close() {
      for (const socket of openSockets) socket.destroy()
      return new Promise<void>((resolve) => front.close(() => resolve()))
    },
  }
}

let credentials: { key: string; cert: string } | null = null

/** A self-signed certificate made once per worker, like the one a device makes at install time. */
function tlsCredentials(): { key: string; cert: string } {
  if (credentials === null) {
    const pems = generate([{ name: 'commonName', value: 'openplc-e2e' }], { days: 1, keySize: 2048 })
    credentials = { key: pems.private, cert: pems.cert }
  }
  return credentials
}

/** Serves @p handler over HTTPS with a self-signed certificate, as a device does. */
async function startHttps(
  address: string,
  port: number,
  handler: (path: string) => { status: number; body: object; headers?: Record<string, string> },
): Promise<FakeHttpsEndpoint> {
  const paths: string[] = []
  const server: HttpsServer = createHttpsServer(tlsCredentials(), (req, res) => {
    const path = req.url ?? ''
    paths.push(path)
    const reply = handler(path)
    res.writeHead(reply.status, { 'Content-Type': 'application/json', ...(reply.headers ?? {}) })
    res.end(JSON.stringify(reply.body))
  })
  await new Promise<void>((resolve) => server.listen(port, address, resolve))
  return {
    paths,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

/** An OpenPLC Runtime v4 on 8443 that has user accounts (`withUsers`) or none. */
export function startFakeRuntime(address: string, withUsers: boolean): Promise<FakeHttpsEndpoint> {
  return startHttps(address, 8443, (path) =>
    path === '/api/get-users-info'
      ? {
          status: withUsers ? 200 : 404,
          body: { msg: withUsers ? 'Users found' : 'No users found' },
          headers: { 'X-OpenPLC-Runtime-Version': 'v4.3.1' },
        }
      : { status: 404, body: {} },
  )
}

/** A bootloader on 8445 that reports @p state through its capabilities. */
export function startFakeBootloader(address: string, state: string, recovery: boolean): Promise<FakeHttpsEndpoint> {
  return startHttps(address, 8445, (path) =>
    path === '/api/bootloader/capabilities'
      ? { status: 200, body: { service: 'openplc-bootloader', state, recovery } }
      : { status: 404, body: {} },
  )
}

/** A listener on 8443 that resets every connection before any TLS reply. */
export async function startResettingRuntimePort(
  address: string,
): Promise<{ accepted(): number; close(): Promise<void> }> {
  let accepted = 0
  const server = createNetServer((socket) => {
    accepted += 1
    socket.resetAndDestroy()
  })
  await new Promise<void>((resolve) => server.listen(8443, address, resolve))
  return {
    accepted: () => accepted,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
