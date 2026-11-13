import { ChildProcess, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'

/** Repository root, five levels above this helper's folder. */
export const REPO_ROOT = path.resolve(__dirname, '../../../../..')

/** The CLI entry of the tool. */
export const CLI_ENTRY = path.join(REPO_ROOT, 'scripts/bench/modbus-hostile-slave/cli.ts')

/** One parsed JSON line of the tool's log. */
export type LogLine = Record<string, unknown>

/** True when `value` is a plain JSON object, not an array or null. */
export function isLogLine(value: unknown): value is LogLine {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Every JSON line of a log file, parsed; a line that is not a JSON object fails the parse. */
export function readLog(file: string): LogLine[] {
  if (!existsSync(file)) {
    return []
  }
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const parsed: unknown = JSON.parse(line)
      if (!isLogLine(parsed)) {
        throw new Error(`log line is not a JSON object: ${line}`)
      }
      return parsed
    })
}

/** A running instance of the CLI, with its stdout and stderr captured. */
export class RunningCli {
  stdout = ''
  stderr = ''
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>

  constructor(readonly child: ChildProcess) {
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      this.stdout += chunk
    })
    child.stderr?.on('data', (chunk: string) => {
      this.stderr += chunk
    })
    this.exited = new Promise((resolve) => {
      child.on('exit', (code, signal) => resolve({ code, signal }))
    })
  }

  /** Sends SIGTERM and waits for the process to exit. */
  async stop(): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill('SIGTERM')
    }
    return this.exited
  }
}

/** Starts the CLI through ts-node in transpile-only mode, from the repository root. */
export function startCli(args: readonly string[]): RunningCli {
  const child = spawn(process.execPath, ['--require', 'ts-node/register', CLI_ENTRY, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, TS_NODE_TRANSPILE_ONLY: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return new RunningCli(child)
}

function listeningPortIn(lines: readonly LogLine[]): number | null {
  const listening = lines.find((line) => line.event === 'listening' && typeof line.port === 'number')
  return listening ? Number(listening.port) : null
}

function stdoutLines(text: string): LogLine[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{'))
    .flatMap((line) => {
      try {
        const parsed: unknown = JSON.parse(line)
        return isLogLine(parsed) ? [parsed] : []
      } catch {
        return []
      }
    })
}

/** Waits for the `{ event: 'listening', port }` line in the log file or on stdout and returns the port. */
export function waitForListening(cli: RunningCli, logFile: string, deadlineMs = 30_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const poll = setInterval(() => {
      const port = listeningPortIn(readLog(logFile)) ?? listeningPortIn(stdoutLines(cli.stdout))
      if (port !== null) {
        clearInterval(poll)
        resolve(port)
      } else if (cli.child.exitCode !== null || cli.child.signalCode !== null) {
        clearInterval(poll)
        reject(new Error(`CLI exited before listening: ${cli.stderr}`))
      } else if (Date.now() - started > deadlineMs) {
        clearInterval(poll)
        reject(new Error(`CLI did not report listening within ${deadlineMs} ms: ${cli.stderr}`))
      }
    }, 25)
  })
}

/** Waits until `predicate` holds on the log file, or the deadline passes. */
export function waitForLog(
  logFile: string,
  predicate: (lines: LogLine[]) => boolean,
  deadlineMs = 5_000,
): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now()
    const poll = setInterval(() => {
      if (predicate(readLog(logFile)) || Date.now() - started > deadlineMs) {
        clearInterval(poll)
        resolve()
      }
    }, 25)
  })
}

/** A free TCP port on 127.0.0.1, for a fake board. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

/** Modbus TCP master used against the tool: writes requests and splits the answer stream into frames. */
export class TcpMaster {
  private buffer = Buffer.alloc(0)
  private waiters: Array<() => void> = []

  private constructor(readonly socket: net.Socket) {
    socket.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk])
      const waiters = this.waiters
      this.waiters = []
      waiters.forEach((wake) => wake())
    })
  }

  static connect(port: number, host = '127.0.0.1'): Promise<TcpMaster> {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ port, host }, () => resolve(new TcpMaster(socket)))
      socket.once('error', reject)
    })
  }

  send(bytes: Buffer): void {
    this.socket.write(bytes)
  }

  /** Waits until at least `count` bytes arrived, then removes and returns exactly `count` bytes. */
  async readBytes(count: number, deadlineMs = 5_000): Promise<Buffer> {
    const started = Date.now()
    while (this.buffer.length < count) {
      if (Date.now() - started > deadlineMs) {
        throw new Error(`expected ${count} bytes, got ${this.buffer.length}: ${this.buffer.toString('hex')}`)
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, deadlineMs)
        this.waiters.push(() => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
    const bytes = this.buffer.subarray(0, count)
    this.buffer = this.buffer.subarray(count)
    return Buffer.from(bytes)
  }

  /** Reads one Modbus TCP frame, sized by its MBAP length field. */
  async readFrame(deadlineMs = 5_000): Promise<Buffer> {
    const header = await this.readBytes(6, deadlineMs)
    const rest = await this.readBytes(header.readUInt16BE(4), deadlineMs)
    return Buffer.concat([header, rest])
  }

  /** Drops leading bytes equal to `value` and returns how many were dropped. */
  async skipWhile(value: number, deadlineMs = 10_000): Promise<number> {
    let skipped = 0
    for (;;) {
      const other = this.buffer.findIndex((byte) => byte !== value)
      if (other >= 0) {
        skipped += other
        this.buffer = Buffer.from(this.buffer.subarray(other))
        return skipped
      }
      skipped += this.buffer.length
      this.buffer = Buffer.alloc(0)
      await this.readBytes(1, deadlineMs).then((first) => {
        this.buffer = Buffer.concat([first, this.buffer])
      })
    }
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.socket.once('close', () => resolve())
      this.socket.end()
    })
  }
}
