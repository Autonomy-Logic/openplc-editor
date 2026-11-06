/** @jest-environment node */

import type { ServerChannel } from 'ssh2'

import type {
  SshAuthChoice,
  SshSession,
  SshSessionOpenRequest,
  SshSessionOpenResult,
} from '../../../../middleware/shared/ports/runtime-provisioning-mechanisms'
import { createSshSessionMechanism } from '../ssh-session'
import type { ExecBehaviour, SshServerBehaviour, TestSshServer } from './fixtures/local-servers'
import {
  LOOPBACK,
  refusedPort,
  SERVER_PASSWORD,
  SERVER_USERNAME,
  startRawServer,
  startSshServer,
} from './fixtures/local-servers'

const OPEN_TIMEOUT_MS = 10_000
const SHORT_TIMEOUT_MS = 200

const servers: TestSshServer[] = []
const sessions: SshSession[] = []
const stops: (() => Promise<void>)[] = []

async function serve(behaviour: SshServerBehaviour = {}): Promise<TestSshServer> {
  const server = await startSshServer(behaviour)
  servers.push(server)
  return server
}

function passwordLogin(): (methodsLeft: string[] | null) => SshAuthChoice {
  let passwordSent = false
  return (methodsLeft) => {
    if (methodsLeft === null) return 'none'
    if (passwordSent) return 'stop'
    passwordSent = true
    return 'password'
  }
}

function request(port: number, overrides: Partial<SshSessionOpenRequest> = {}): SshSessionOpenRequest {
  return {
    host: LOOPBACK,
    port,
    username: SERVER_USERNAME,
    password: SERVER_PASSWORD,
    timeoutMs: OPEN_TIMEOUT_MS,
    verifyHostKey: () => Promise.resolve(true),
    chooseAuth: passwordLogin(),
    ...overrides,
  }
}

async function open(port: number, overrides: Partial<SshSessionOpenRequest> = {}): Promise<SshSessionOpenResult> {
  const result = await createSshSessionMechanism().open(request(port, overrides))
  if (result.kind === 'open') sessions.push(result.session)
  return result
}

async function openSession(port: number): Promise<SshSession> {
  const result = await open(port)
  if (result.kind !== 'open') throw new Error(`expected an open session, got ${result.message}`)
  return result.session
}

function laterTick<T>(value: T): Promise<T> {
  return new Promise((resolve) => setImmediate(() => resolve(value)))
}

function afterStdinEnds(reply: (stdin: string, channel: ServerChannel) => void): ExecBehaviour {
  return (_command, channel) => {
    let stdin = ''
    channel.on('data', (chunk: Uint8Array) => {
      stdin += new TextDecoder().decode(chunk)
    })
    channel.on('end', () => reply(stdin, channel))
  }
}

afterEach(async () => {
  sessions.splice(0).forEach((session) => session.close())
  await Promise.all(servers.splice(0).map((server) => server.stop()))
  await Promise.all(stops.splice(0).map((stop) => stop()))
  jest.restoreAllMocks()
})

describe('opening an SSH session', () => {
  it('hands the presented host key to verifyHostKey as base64, once, before any authentication (M1)', async () => {
    const server = await serve()
    const verified: { key: string; authAttemptsSoFar: number }[] = []

    await open(server.port, {
      verifyHostKey: (key) => {
        verified.push({ key, authAttemptsSoFar: server.authAttempts.length })
        return Promise.resolve(true)
      },
    })

    expect(verified).toEqual([{ key: server.hostKey.publicBlob, authAttemptsSoFar: 0 }])
  })

  it('stops before any authentication when verifyHostKey resolves false on a later tick (AS-01)', async () => {
    const server = await serve()
    const choices: (string[] | null)[] = []

    const result = await open(server.port, {
      verifyHostKey: () => laterTick(false),
      chooseAuth: (methodsLeft) => {
        choices.push(methodsLeft)
        return 'password'
      },
    })

    expect(result.kind).toBe('error')
    expect(server.authAttempts).toEqual([])
    expect(choices).toEqual([])
  })

  it('opens after verifyHostKey resolves true on a later tick', async () => {
    const server = await serve()

    const result = await open(server.port, { verifyHostKey: () => laterTick(true) })

    expect(result.kind).toBe('open')
  })

  it('asks chooseAuth with null first, then with the methods the server lists, and maps none and password', async () => {
    const server = await serve({
      authenticate: (context) => {
        if (context.method === 'password' && context.password === SERVER_PASSWORD) context.accept()
        else context.reject(['password', 'publickey'])
      },
    })
    const asked: (string[] | null)[] = []

    const result = await open(server.port, {
      chooseAuth: (methodsLeft) => {
        asked.push(methodsLeft)
        return methodsLeft === null ? 'none' : asked.length === 2 ? 'password' : 'stop'
      },
    })

    expect(result.kind).toBe('open')
    expect(asked).toEqual([null, ['password', 'publickey']])
    expect(server.authAttempts).toEqual([
      { method: 'none', username: SERVER_USERNAME },
      { method: 'password', username: SERVER_USERNAME, password: SERVER_PASSWORD },
    ])
  })

  it('sends nothing more and reports the authentication error when chooseAuth answers stop', async () => {
    const server = await serve()

    const result = await open(server.port, { chooseAuth: () => 'stop' })

    expect(result).toEqual(expect.objectContaining({ kind: 'error', level: 'client-authentication' }))
    expect(server.authAttempts).toEqual([])
  })

  it('stops after none when the server lists only publickey and chooseAuth answers stop (TC57)', async () => {
    const server = await serve({ authenticate: (context) => context.reject(['publickey']) })

    const result = await open(server.port, {
      chooseAuth: (methodsLeft) => (methodsLeft === null ? 'none' : 'stop'),
    })

    expect(result).toEqual(expect.objectContaining({ kind: 'error', level: 'client-authentication' }))
    expect(server.authAttempts).toEqual([{ method: 'none', username: SERVER_USERNAME }])
  })

  it('never tries keyboard-interactive, a public key or an agent, even when the server lists them (P6)', async () => {
    const server = await serve({
      authenticate: (context) => {
        if (context.method === 'password' && context.password === SERVER_PASSWORD) context.accept()
        else context.reject(['keyboard-interactive', 'publickey', 'password'])
      },
    })

    await open(server.port)

    expect(server.authAttempts.map((attempt) => attempt.method)).toEqual(['none', 'password'])
  })

  it('reports a refused connection with the socket level and its code', async () => {
    const port = await refusedPort()

    const result = await open(port)

    expect(result).toEqual({
      kind: 'error',
      level: 'client-socket',
      code: 'ECONNREFUSED',
      message: expect.any(String),
    })
  })

  it('reports a server that never completes the handshake as a timeout at timeoutMs', async () => {
    const silent = await startRawServer(() => undefined)
    stops.push(() => silent.stop())

    const result = await open(silent.port, { timeoutMs: SHORT_TIMEOUT_MS })

    expect(result).toEqual(expect.objectContaining({ kind: 'error', level: 'client-timeout' }))
  })

  it('never writes the password to the console', async () => {
    const printed: unknown[][] = []
    const record = (...args: unknown[]) => {
      printed.push(args)
    }
    jest.spyOn(console, 'log').mockImplementation(record)
    jest.spyOn(console, 'info').mockImplementation(record)
    jest.spyOn(console, 'warn').mockImplementation(record)
    jest.spyOn(console, 'error').mockImplementation(record)
    jest.spyOn(console, 'debug').mockImplementation(record)
    const server = await serve()

    await open(server.port)
    await open(server.port, { password: 'wrong-pass', chooseAuth: passwordLogin() })

    expect(JSON.stringify(printed)).not.toContain(SERVER_PASSWORD)
    expect(JSON.stringify(printed)).not.toContain('wrong-pass')
  })
})

describe('running a command on the session', () => {
  it('writes stdin when given, ends it, and resolves on close with the exit code', async () => {
    const server = await serve({
      exec: afterStdinEnds((stdin, channel) => {
        channel.write(`got:${stdin}`)
        channel.exit(0)
        channel.end()
      }),
    })
    const session = await openSession(server.port)

    await expect(session.exec('cat', { stdin: 'S3cr3t-Pi!\n', maxOutputBytes: 1024 })).resolves.toMatchObject({
      exitCode: 0,
      stdout: 'got:S3cr3t-Pi!\n',
      stderr: '',
      truncated: false,
    })
    expect(server.commands).toEqual(['cat'])
  })

  it('ends stdin even when no stdin is given', async () => {
    const server = await serve({
      exec: afterStdinEnds((stdin, channel) => {
        channel.write(`stdin was ${stdin.length} bytes`)
        channel.exit(0)
        channel.end()
      }),
    })
    const session = await openSession(server.port)

    await expect(session.exec('uname -m', { maxOutputBytes: 1024 })).resolves.toMatchObject({
      exitCode: 0,
      stdout: 'stdin was 0 bytes',
      stderr: '',
      truncated: false,
    })
  })

  it('keeps stdout and stderr apart and reports a non-zero exit code', async () => {
    const server = await serve({
      exec: (_command, channel) => {
        channel.write('out\n')
        channel.stderr.write('err\n')
        channel.exit(3)
        channel.end()
      },
    })
    const session = await openSession(server.port)

    await expect(session.exec('false', { maxOutputBytes: 1024 })).resolves.toMatchObject({
      exitCode: 3,
      stdout: 'out\n',
      stderr: 'err\n',
      truncated: false,
    })
  })

  it('reports a null exit code when the command was killed by a signal', async () => {
    const server = await serve({
      exec: (_command, channel) => {
        channel.exit('KILL')
        channel.end()
      },
    })
    const session = await openSession(server.port)

    const result = await session.exec('sleep 600', { maxOutputBytes: 1024 })

    expect(result.exitCode).toBeNull()
  })

  it('bounds stdout and stderr together, marks the result truncated and still resolves on close', async () => {
    const server = await serve({
      exec: (_command, channel) => {
        channel.write('a'.repeat(5000))
        channel.stderr.write('b'.repeat(5000))
        channel.exit(0)
        channel.end()
      },
    })
    const session = await openSession(server.port)

    const result = await session.exec('flood', { maxOutputBytes: 1000 })

    expect(result.truncated).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.stdout.length + result.stderr.length).toBeLessThanOrEqual(1000)
    expect(result.stdout).toMatch(/^a*$/)
    expect(result.stderr).toMatch(/^b*$/)
  })

  it('returns all output and no truncation below the limit', async () => {
    const server = await serve({
      exec: (_command, channel) => {
        channel.write('a'.repeat(400))
        channel.stderr.write('b'.repeat(400))
        channel.exit(0)
        channel.end()
      },
    })
    const session = await openSession(server.port)

    await expect(session.exec('small', { maxOutputBytes: 1000 })).resolves.toMatchObject({
      exitCode: 0,
      stdout: 'a'.repeat(400),
      stderr: 'b'.repeat(400),
      truncated: false,
    })
  })

  it('returns the stdout bytes as received, a character split between two writes included, beside their text', async () => {
    const sent = new TextEncoder().encode('Größe: 5 €\n')
    const insideEuro = sent.indexOf(0xe2) + 1
    const server = await serve({
      exec: (_command, channel) => {
        channel.write(sent.subarray(0, insideEuro))
        channel.write(sent.subarray(insideEuro))
        channel.exit(0)
        channel.end()
      },
    })
    const session = await openSession(server.port)

    const result = await session.exec('cat install.log', { maxOutputBytes: 1024 })

    expect(Array.from(result.stdoutBytes)).toEqual(Array.from(sent))
    expect(result.stdout).toBe('Größe: 5 €\n')
  })

  it('keeps the stdout bytes within the output bound', async () => {
    const server = await serve({
      exec: (_command, channel) => {
        channel.write('a'.repeat(5000))
        channel.exit(0)
        channel.end()
      },
    })
    const session = await openSession(server.port)

    const result = await session.exec('flood', { maxOutputBytes: 1000 })

    expect(result.truncated).toBe(true)
    expect(Array.from(result.stdoutBytes)).toEqual(Array.from(new TextEncoder().encode(result.stdout)))
    expect(result.stdoutBytes.length).toBeLessThanOrEqual(1000)
  })

  it('runs several commands one after another on the same session', async () => {
    const server = await serve({
      exec: (command, channel) => {
        channel.write(`ran ${command}`)
        channel.exit(0)
        channel.end()
      },
    })
    const session = await openSession(server.port)

    const first = await session.exec('first', { maxOutputBytes: 1024 })
    const second = await session.exec('second', { maxOutputBytes: 1024 })

    expect([first.stdout, second.stdout]).toEqual(['ran first', 'ran second'])
    expect(server.connectionCount()).toBe(1)
  })
})

describe('closing the session', () => {
  it('close ends the connection to the server', async () => {
    const server = await serve()
    const session = await openSession(server.port)

    session.close()

    await expect(server.firstClientGone()).resolves.toBeUndefined()
  })

  it('onClosed fires when the server drops the connection, and an unsubscribed callback does not', async () => {
    const server = await serve()
    const session = await openSession(server.port)
    const kept = jest.fn()
    const removed = jest.fn()
    const closed = new Promise<void>((resolve) => session.onClosed(() => resolve()))
    session.onClosed(kept)
    const unsubscribe = session.onClosed(removed)

    unsubscribe()
    server.dropClients()
    await closed

    expect(kept).toHaveBeenCalledTimes(1)
    expect(removed).not.toHaveBeenCalled()
  })
})
