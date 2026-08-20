/**
 * The headless CLI's entry point.
 *
 * Runs inside Electron's main process with NO window, because that is the only
 * way to reuse the editor's real pipeline: `CompilerModule` resolves the
 * arduino-cli config, the strucpp runtime includes, the licence store and the
 * installed VPP packages through `app.getPath('userData')` / `app.getAppPath()`,
 * and ten other modules under `backend/editor` import `electron` directly.
 * Making this a literal plain-Node process would mean de-Electroning that whole
 * layer — a large refactor of GUI code paths, with a new risk surface on
 * package integrity, for no GUI benefit.
 *
 * Running as Electron main gives what "headless" was actually for (no window,
 * no renderer, scriptable, CI-runnable) and is strictly better for the testing
 * goal: the CLI resolves the SAME paths, packages and licence store the GUI
 * does. A separate path resolver for the CLI would be exactly the divergence
 * this tool exists to detect.
 *
 * No `app.whenReady()` is awaited: nothing here needs the GUI subsystems, and
 * not waiting is what lets the CLI run on a machine with no display.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { RuntimeApiClient } from '@root/backend/editor/runtime/runtime-api-client'
import { APP_VERSION } from '@root/frontend/data/constants/app-version'
import { app } from 'electron'

import { boolFlag, parseArgs, type ParsedArgs, stringFlag } from './args'
import { runBuild } from './commands/build'
import { type DebugContext, runDebug } from './commands/debug'
import { runDevices } from './commands/devices'
import { runDaemonFromStdin } from './daemon-entry'
import { ErrorCode, ExitCode, type ExitCodeValue } from './exit-codes'
import { createProcessReporter, Reporter } from './output'
import { SessionRegistry } from './session/registry'
import { createSessionSpawner } from './spawn-session'

/**
 * Flags that must never consume the following token. Missing one here is how
 * `--upload-if-needed --target x` silently parses `--target` as a value.
 */
const BOOLEAN_FLAGS = [
  'json',
  'quiet',
  'verbose',
  'help',
  'version',
  'clean',
  'upload-if-needed',
  'force-new',
  'keep-forces',
  'keep-going',
  'all',
] as const

const COMMANDS_WITH_SUBCOMMANDS = ['debug'] as const

const USAGE = `openplc — headless OpenPLC Editor

Usage
  openplc devices [--timeout <ms>]
  openplc compile <project> [--target <board>] [--clean]
  openplc upload  <project> --host <address> [--target <board>] [--clean]
  openplc debug open <project> --host <address> --target <board> [--upload-if-needed]
  openplc debug list
  openplc debug status | list-vars | read | write | force | unforce | start | stop | watch | poll | unwatch
  openplc debug close --session <id> | --all [--keep-forces]
  openplc debug repl [--session <id>]                       (interactive; needs a terminal)
  openplc debug exec [script|-] [--session <id>] [--keep-going]  (one command per line)

Credentials (upload, debug)
  --credentials user:pass, or --user + --password
  or OPENPLC_CREDENTIALS / OPENPLC_USER + OPENPLC_PASSWORD (keeps them out of shell history)

Paths
  --user-data <dir>  override the editor state directory (arduino-cli config, licence store,
                     installed VPP packages). Defaults to the same directory the GUI uses.

Output
  JSON when stdout is not a terminal, human-readable when it is; --json / --no-json override.
  Progress goes to stderr, so stdout carries exactly one JSON document.

Exit codes
  0 ok · 2 usage · 3 not found · 4 compile failed · 5 connection · 6 auth · 7 target error · 8 timeout · 70 internal`

/**
 * Point this process at the SAME `userData` directory the editor GUI uses.
 *
 * Electron derives `userData` from `app.getName()`, and it only picks the app's
 * own name up when it is handed an app DIRECTORY (or is packaged). Launched as
 * `electron path/to/cli.js` it keeps the default "Electron", so `userData`
 * becomes `…/Application Support/Electron` — a directory with no arduino-cli
 * config, no licence store and, decisively, no installed VPP packages. The
 * first symptom is a compile failing with `Board "SLM-RP4" not found in
 * hals.json or installed VPP packages` for a board the GUI builds happily.
 *
 * The name is READ from the app's package.json rather than hardcoded, so it
 * cannot drift from whatever the GUI resolves. Packaged builds already carry
 * electron-builder's `productName`, so they are left alone.
 */
function alignUserDataWithEditor(explicitDir: string | undefined): void {
  if (explicitDir) {
    app.setPath('userData', explicitDir)
    return
  }
  if (app.isPackaged) return
  const name = nearestAppName(app.getAppPath())
  if (!name) return
  // `setPath` rather than `setName` alone: Electron resolves `userData` at
  // process start, so renaming the app afterwards does not move it. Setting the
  // path explicitly does, and it is the value that actually matters here.
  app.setName(name)
  app.setPath('userData', join(app.getPath('appData'), name))
}

/**
 * The `name` from the nearest package.json at or above `from`.
 *
 * Walking up is required, not defensive: launched as `electron
 * path/to/build/cli.js`, `app.getAppPath()` is the BUILD directory, which has
 * no package.json — reading only there silently finds nothing and leaves the
 * process on the default "Electron" userData, which is how a board the GUI
 * builds fine comes back as "not found in hals.json or installed VPP packages".
 */
function nearestAppName(from: string): string | undefined {
  let directory = from
  for (;;) {
    try {
      const manifest: unknown = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf-8'))
      if (typeof manifest === 'object' && manifest !== null) {
        const fields: Record<string, unknown> = { ...manifest }
        if (typeof fields.name === 'string' && fields.name.length > 0) return fields.name
      }
    } catch {
      // No manifest here; try the parent.
    }
    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
}

/** Where session records and sockets live: per-user, beside the editor's own state. */
export function registryDir(): string {
  return join(app.getPath('userData'), 'User', 'cli-sessions')
}

async function dispatch(args: ParsedArgs, reporter: Reporter): Promise<ExitCodeValue> {
  // Version before the no-command branch: `openplc --version` has no command,
  // and answering it with the usage text (plus a usage exit code) is wrong.
  if (boolFlag(args, 'version') || args.command === 'version') {
    return reporter.success({ version: APP_VERSION }, () => APP_VERSION).exitCode
  }

  if (boolFlag(args, 'help') || args.command === 'help' || args.command === undefined) {
    process.stdout.write(`${USAGE}\n`)
    // No command at all is a usage error; asking for help is not.
    return args.command === undefined && !boolFlag(args, 'help') ? ExitCode.Usage : ExitCode.Ok
  }

  switch (args.command) {
    case 'devices':
      return (await runDevices(args, reporter)).exitCode
    case 'compile':
      return (await runBuild(args, reporter, { withUpload: false })).exitCode
    case 'upload':
      return (await runBuild(args, reporter, { withUpload: true })).exitCode
    case 'debug':
      return (await runDebug(args, reporter, buildDebugContext())).exitCode
    default:
      return reporter.failure(
        { code: ErrorCode.UnknownCommand, message: `Unknown command "${args.command}". Try \`openplc --help\`.` },
        ExitCode.Usage,
      ).exitCode
  }
}

function buildDebugContext(): DebugContext {
  const dir = registryDir()
  return {
    registry: new SessionRegistry(dir),
    spawnSession: createSessionSpawner({
      registryDir: dir,
      execPath: process.execPath,
      execArgs: [cliEntryPath()],
      uploadProgram: async ({ projectPath, target, host, username, password, onLine }) => {
        // The upload path is the ordinary `upload` command, driven in-process so
        // there is exactly one implementation of compile-then-flash.
        // A reporter whose progress channel forwards to the caller's `onLine`
        // and whose result channel is discarded — `debug open` reports the
        // outcome itself, so a second result document would be noise.
        const uploadReporter = new Reporter({
          mode: 'json',
          streams: { out: () => undefined, err: (text) => onLine(text.replace(/\n$/, '')) },
        })
        const result = await runBuild(
          {
            command: 'upload',
            subcommand: undefined,
            positionals: [projectPath],
            flags: { host, target, credentials: `${username}:${password}` },
          },
          uploadReporter,
          { withUpload: true },
        )
        return result.exitCode === ExitCode.Ok
          ? { success: true }
          : { success: false, error: 'The compile-and-upload step failed (see the progress output above)' }
      },
      probeTargetMd5: async ({ host, username, password }) => {
        const runtime = new RuntimeApiClient()
        const login = await runtime.login(host, username, password)
        if (!login.success) return { success: false, error: login.error ?? 'The runtime rejected the credentials' }
        const result = await runtime.makeRuntimeApiRequest(host, '/api/compilation-status', (body: string) => {
          const parsed: unknown = JSON.parse(body)
          const md5 = typeof parsed === 'object' && parsed !== null ? (parsed as { md5?: unknown }).md5 : undefined
          return { md5: typeof md5 === 'string' ? md5 : null }
        })
        // A runtime that does not publish an MD5 over REST is not an error: the
        // session's own debug-channel probe is authoritative, this is only a
        // shortcut to avoid a needless upload.
        return { success: true, md5: result.success ? (result.data?.md5 ?? null) : null }
      },
    }),
  }
}

/**
 * The script to hand Electron when re-entering this program as a daemon.
 *
 * It must be the CLI BUNDLE, never the app directory. Passing
 * `app.getAppPath()` here launched the editor GUI: Electron treats a directory
 * as an app package, reads `package.json`'s `main`, and starts the window —
 * so `debug open` opened the editor instead of a headless session. Anything
 * that can resolve to the app entry is therefore refused rather than guessed
 * at, because the failure mode is "silently starts the wrong program".
 */
function cliEntryPath(): string {
  // Dev: Electron was handed this bundle's path, and webpack leaves __filename
  // as the real runtime path (`node: { __filename: false }`).
  const candidate = app.isPackaged ? join(app.getAppPath(), 'dist', 'main', 'cli.js') : (process.argv[1] ?? __filename)
  if (!candidate.endsWith('.js')) {
    throw new Error(
      `Cannot locate the CLI bundle to spawn a debug session (resolved "${candidate}"). ` +
        'Refusing to re-launch, because a non-bundle path starts the editor GUI instead.',
    )
  }
  return candidate
}

async function main(): Promise<void> {
  // The daemon reads its config from stdin and never parses argv.
  if (process.argv.includes('--cli-daemon')) {
    alignUserDataWithEditor(undefined)
    await runDaemonFromStdin()
    return
  }

  const argv = cliArgv(process.argv)
  const args = parseArgs(argv, {
    booleanFlags: BOOLEAN_FLAGS,
    commandsWithSubcommands: COMMANDS_WITH_SUBCOMMANDS,
  })

  // Before anything reads an app path: the compiler, the licence store and the
  // package manager all resolve off `userData`.
  alignUserDataWithEditor(stringFlag(args, 'user-data'))

  const reporter = createProcessReporter({
    json: boolFlag(args, 'json'),
    noJson: args.flags.json === false,
    quiet: boolFlag(args, 'quiet'),
  })

  let exitCode: ExitCodeValue
  try {
    exitCode = await dispatch(args, reporter)
  } catch (error) {
    exitCode = reporter.internalError(error).exitCode
  }
  app.exit(exitCode)
}

/**
 * Strip the launcher's own arguments.
 *
 * Packaged: `[app, ...userArgs]`. Development: `[electron, scriptPath,
 * ...userArgs]`. Getting this wrong makes the first user argument disappear,
 * which reads as a missing command rather than as an argv bug.
 */
export function cliArgv(argv: readonly string[]): string[] {
  const rest = argv.slice(1)
  const withoutMarker = rest.filter((argument) => argument !== '--cli')
  if (withoutMarker.length > 0 && !withoutMarker[0].startsWith('-') && looksLikeEntryPath(withoutMarker[0])) {
    return withoutMarker.slice(1)
  }
  return withoutMarker
}

function looksLikeEntryPath(value: string): boolean {
  return value.endsWith('.js') || value.endsWith('.ts') || value.endsWith('.asar') || value.includes('/dist/')
}

/** `stringFlag` is re-exported for the daemon entry, which shares the parser. */
export { stringFlag }

void main()
