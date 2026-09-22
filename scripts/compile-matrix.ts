/**
 * Compile one project against many boards and report what broke.
 *
 * The question this answers is "does this program still build everywhere", which
 * nothing in the test suite asks: every test mocks arduino-cli, so a change that
 * breaks a real toolchain passes CI. It is also how a core-version pin gets
 * proven — a manifest can claim any version, and only `Used platform` in the
 * build output says which one the compiler actually used.
 *
 * Which packages are in play is decided by `--user-data`, not by this script:
 * point it at one directory holding the production packages and another holding
 * locally built ones, and the same command compares them. `--install` fills a
 * directory first, through the CLI's own signature-checked install.
 *
 * Usage
 *   ts-node scripts/compile-matrix.ts <project> [options]
 *
 *   --user-data <dir>     editor state to compile against (default: the GUI's)
 *   --install <path>...   .vpp files or directories to install first
 *   --board <name>...     only these boards (repeatable, exact name)
 *   --package <id>...     only boards from these packages (repeatable)
 *   --core <id>...        only boards on these cores, e.g. arduino:samd
 *   --arduino-only        skip targets that do not build firmware locally
 *   --clean               pass --clean to every compile
 *   --keep-going          do not stop after the first failure (default)
 *   --stop-on-fail        stop at the first failure
 *   --out <file>          JSONL log (default: <project>/compile-matrix.jsonl)
 */

import { spawn } from 'node:child_process'
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const ELECTRON_ENTRY = './release/app/dist/main/main.js'
const ANSI = /\x1b\[[0-9;]*m/g

interface BoardRow {
  name: string
  packageId?: string
  compiler: string
  core: string
  coreVersion?: string
}

interface Outcome {
  board: string
  packageId?: string
  core: string
  /** What the manifest asked for. */
  pinned?: string
  /** What arduino-cli says it actually compiled against. */
  used?: string
  ok: boolean
  /** `pinned` and `used` disagree — the pin did not take. */
  drifted: boolean
  seconds: number
  errors: string[]
}

interface Options {
  project: string
  userData?: string
  install: string[]
  boards: string[]
  packages: string[]
  cores: string[]
  arduinoOnly: boolean
  clean: boolean
  stopOnFail: boolean
  out?: string
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    project: '',
    install: [],
    boards: [],
    packages: [],
    cores: [],
    arduinoOnly: false,
    clean: false,
    stopOnFail: false,
  }
  const positionals: string[] = []

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    const takeValue = (): string => {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${token} needs a value`)
      i += 1
      return value
    }
    switch (token) {
      case '--user-data':
        options.userData = resolve(takeValue())
        break
      case '--install':
        options.install.push(resolve(takeValue()))
        break
      case '--board':
        options.boards.push(takeValue())
        break
      case '--package':
        options.packages.push(takeValue())
        break
      case '--core':
        options.cores.push(takeValue())
        break
      case '--out':
        options.out = resolve(takeValue())
        break
      case '--arduino-only':
        options.arduinoOnly = true
        break
      case '--clean':
        options.clean = true
        break
      case '--stop-on-fail':
        options.stopOnFail = true
        break
      case '--keep-going':
        options.stopOnFail = false
        break
      default:
        if (token.startsWith('--')) throw new Error(`Unknown option ${token}`)
        positionals.push(token)
    }
  }

  if (positionals.length !== 1) throw new Error('Name exactly one project directory')
  options.project = resolve(positionals[0])
  return options
}

/** Run the CLI and hand back everything it printed, on both streams. */
function runCli(args: string[], onLine?: (line: string) => void): Promise<{ code: number; output: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('npx', ['electron', ELECTRON_ENTRY, '--cli', ...args], {
      // The CLI decides its output mode from whether stdout is a TTY; piping it
      // gives us JSON where a JSON shape exists, and captures the compiler's
      // own prose either way.
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const absorb = (chunk: Buffer): void => {
      const text = chunk.toString()
      output += text
      if (onLine) for (const line of text.split('\n')) if (line.trim()) onLine(line)
    }
    child.stdout.on('data', absorb)
    child.stderr.on('data', absorb)
    child.on('error', rejectPromise)
    child.on('close', (code) => resolvePromise({ code: code ?? -1, output }))
  })
}

function userDataArgs(options: Options): string[] {
  return options.userData ? ['--user-data', options.userData] : []
}

async function listBoards(options: Options): Promise<BoardRow[]> {
  const { code, output } = await runCli(['packages', 'list', ...userDataArgs(options)])
  if (code !== 0) throw new Error(`packages list failed (exit ${code}):\n${output}`)

  // The CLI prints exactly one JSON document on stdout when stdout is a pipe,
  // but this capture merges stderr's progress lines in, so scan for the line
  // that parses rather than assuming the buffer is the document.
  for (const line of output.split('\n').reverse()) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (typeof parsed !== 'object' || parsed === null || !('ok' in parsed)) continue
    return (parsed as { boards?: BoardRow[] }).boards ?? []
  }
  throw new Error(`packages list produced no JSON document:\n${output}`)
}

function selectBoards(all: BoardRow[], options: Options): BoardRow[] {
  return all.filter((board) => {
    if (options.arduinoOnly && board.compiler !== 'arduino-cli') return false
    if (options.boards.length > 0 && !options.boards.includes(board.name)) return false
    if (options.packages.length > 0 && (board.packageId === undefined || !options.packages.includes(board.packageId)))
      return false
    if (options.cores.length > 0 && !options.cores.includes(board.core)) return false
    return true
  })
}

/**
 * The core version arduino-cli reports for the build it just ran.
 *
 * This is the whole point of capturing output: a pin in a manifest is a request,
 * and a build that quietly used another version looks exactly like a build that
 * honoured it.
 */
function usedPlatform(output: string): string | undefined {
  const lines = output.replace(ANSI, '').split('\n')
  const header = lines.findIndex((line) => line.trim().startsWith('Used platform'))
  if (header === -1) return undefined
  for (const line of lines.slice(header + 1)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length >= 3 && parts[0].includes(':')) return parts[1]
  }
  return undefined
}

function compileErrors(output: string): string[] {
  const seen = new Set<string>()
  for (const line of output.replace(ANSI, '').split('\n')) {
    const trimmed = line.trim()
    if (/\b(error|fatal error|undefined reference)\b/i.test(trimmed)) seen.add(trimmed)
    if (seen.size >= 8) break
  }
  return Array.from(seen)
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2))
  const logPath = options.out ?? join(options.project, 'compile-matrix.jsonl')
  await mkdir(dirname(logPath), { recursive: true })
  await writeFile(logPath, '')

  if (options.install.length > 0) {
    process.stderr.write(`Installing packages from ${options.install.length} path(s)…\n`)
    const { code, output } = await runCli(['packages', 'install', ...options.install, ...userDataArgs(options)])
    if (code !== 0) {
      process.stderr.write(`${output}\n`)
      throw new Error(`packages install failed (exit ${code})`)
    }
  }

  const boards = selectBoards(await listBoards(options), options)
  if (boards.length === 0) throw new Error('No board matched the filters')

  process.stderr.write(`Compiling ${options.project} against ${boards.length} board(s)\n\n`)

  const outcomes: Outcome[] = []
  for (const [index, board] of boards.entries()) {
    const started = Date.now()
    process.stderr.write(`[${index + 1}/${boards.length}] ${board.name} … `)

    const { code, output } = await runCli([
      'compile',
      options.project,
      '--target',
      board.name,
      ...(options.clean ? ['--clean'] : []),
      ...userDataArgs(options),
    ])

    const used = usedPlatform(output)
    const outcome: Outcome = {
      board: board.name,
      ...(board.packageId ? { packageId: board.packageId } : {}),
      core: board.core,
      ...(board.coreVersion ? { pinned: board.coreVersion } : {}),
      ...(used ? { used } : {}),
      ok: code === 0,
      drifted: board.coreVersion !== undefined && used !== undefined && used !== board.coreVersion,
      seconds: Math.round((Date.now() - started) / 100) / 10,
      errors: code === 0 ? [] : compileErrors(output),
    }
    outcomes.push(outcome)
    await appendFile(logPath, `${JSON.stringify(outcome)}\n`)

    const verdict = outcome.ok ? (outcome.drifted ? `DRIFT (used ${used})` : 'ok') : `FAIL (exit ${code})`
    process.stderr.write(`${verdict} ${outcome.seconds}s\n`)
    if (!outcome.ok) for (const error of outcome.errors.slice(0, 3)) process.stderr.write(`      ${error}\n`)
    if (!outcome.ok && options.stopOnFail) break
  }

  const failed = outcomes.filter((outcome) => !outcome.ok)
  const drifted = outcomes.filter((outcome) => outcome.ok && outcome.drifted)

  process.stderr.write(`\n${outcomes.length - failed.length}/${outcomes.length} compiled`)
  process.stderr.write(drifted.length > 0 ? `, ${drifted.length} on a version other than the pin\n` : '\n')
  for (const outcome of failed) process.stderr.write(`  FAIL  ${outcome.board}\n`)
  for (const outcome of drifted) {
    process.stderr.write(`  DRIFT ${outcome.board}: pinned ${outcome.pinned ?? '-'}, used ${outcome.used ?? '-'}\n`)
  }
  process.stderr.write(`\nLog: ${logPath}\n`)

  // A drifted build compiled, so exit 0 would be a lie about the pin holding.
  process.exitCode = failed.length > 0 || drifted.length > 0 ? 1 : 0
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
