import type {
  SshAuthChoice,
  SshExecResult,
  SshSession,
  SshSessionMechanism,
  SshSessionOpenRequest,
  SshSessionOpenResult,
} from '@root/middleware/shared/ports/runtime-provisioning-mechanisms'
import type { AuthenticationType, ClientChannel, NoAuthMethod, PasswordAuthMethod, VerifyCallback } from 'ssh2'
import { Client } from 'ssh2'

type ClientError = Error & { level?: string }

interface OutputBuffer {
  stdout: Uint8Array[]
  stderr: Uint8Array[]
  bytes: number
  truncated: boolean
}

function errorCode(error: object): string | undefined {
  return 'code' in error && typeof error.code === 'string' ? error.code : undefined
}

function openFailure(error: ClientError): SshSessionOpenResult {
  const code = errorCode(error)
  return {
    kind: 'error',
    ...(error.level === undefined ? {} : { level: error.level }),
    ...(code === undefined ? {} : { code }),
    message: error.message,
  }
}

function authMethod(choice: SshAuthChoice, request: SshSessionOpenRequest): NoAuthMethod | PasswordAuthMethod | false {
  switch (choice) {
    case 'none':
      return { type: 'none', username: request.username }
    case 'password':
      return { type: 'password', username: request.username, password: request.password }
    case 'stop':
      return false
  }
}

function collect(output: OutputBuffer, target: Uint8Array[], chunk: Uint8Array, maxOutputBytes: number): void {
  if (output.truncated) return
  const room = maxOutputBytes - output.bytes
  if (chunk.length > room) {
    target.push(chunk.subarray(0, room))
    output.bytes = maxOutputBytes
    output.truncated = true
    return
  }
  target.push(chunk)
  output.bytes += chunk.length
}

function runOnChannel(
  channel: ClientChannel,
  options: { stdin?: string; maxOutputBytes: number },
  resolve: (result: SshExecResult) => void,
): void {
  const output: OutputBuffer = { stdout: [], stderr: [], bytes: 0, truncated: false }
  let exitCode: number | null = null
  channel.on('data', (chunk: Uint8Array) => collect(output, output.stdout, chunk, options.maxOutputBytes))
  channel.stderr.on('data', (chunk: Uint8Array) => collect(output, output.stderr, chunk, options.maxOutputBytes))
  channel.on('exit', (code: number | null) => {
    exitCode = typeof code === 'number' ? code : null
  })
  channel.on('close', () => {
    const stdout = Buffer.concat(output.stdout)
    resolve({
      exitCode,
      stdout: stdout.toString('utf8'),
      stdoutBytes: new Uint8Array(stdout),
      stderr: Buffer.concat(output.stderr).toString('utf8'),
      truncated: output.truncated,
    })
  })
  if (options.stdin !== undefined) channel.write(options.stdin)
  channel.end()
}

function createSession(client: Client): SshSession {
  return {
    exec(command, options) {
      return new Promise<SshExecResult>((resolve, reject) => {
        client.exec(command, (error, channel) => {
          if (error !== undefined) reject(error)
          else runOnChannel(channel, options, resolve)
        })
      })
    },
    close() {
      client.end()
    },
    onClosed(callback) {
      const listener = (): void => callback()
      client.on('close', listener)
      return () => {
        client.removeListener('close', listener)
      }
    },
  }
}

export function createSshSessionMechanism(): SshSessionMechanism {
  return {
    open(request) {
      return new Promise<SshSessionOpenResult>((resolve) => {
        const client = new Client()
        let settled = false
        const settle = (result: SshSessionOpenResult): void => {
          if (settled) return
          settled = true
          resolve(result)
        }
        client.on('error', (error: ClientError) => {
          if (settled) return
          settle(openFailure(error))
          client.end()
        })
        client.once('ready', () => settle({ kind: 'open', session: createSession(client) }))
        client.once('close', () => settle({ kind: 'error', message: 'SSH connection closed before it was ready' }))
        client.connect({
          host: request.host,
          port: request.port,
          username: request.username,
          readyTimeout: request.timeoutMs,
          tryKeyboard: false,
          debug: undefined,
          hostVerifier: (key: Buffer, verify: VerifyCallback): void => {
            request.verifyHostKey(key.toString('base64')).then(verify, () => verify(false))
          },
          authHandler: (methodsLeft: AuthenticationType[] | null) =>
            authMethod(request.chooseAuth(methodsLeft), request),
        })
      })
    },
  }
}
