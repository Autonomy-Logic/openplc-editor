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
import { UserService } from '@root/backend/editor/services'
import { APP_VERSION } from '@root/frontend/data/constants/app-version'
import { app } from 'electron'

import { boolFlag, parseArgs, type ParsedArgs, stringFlag } from './args'
import { cliArgv } from './argv'
import { buildProject, runBuild } from './commands/build'
import { runCreate } from './commands/create'
import { type DebugContext, runDebug } from './commands/debug'
import { runDevices } from './commands/devices'
import { runInstallCli } from './commands/install-cli'
import { runDaemonFromStdin } from './daemon-entry'
import { ErrorCode, ExitCode, type ExitCodeValue } from './exit-codes'
import { createProcessReporter, Reporter } from './output'
import { SessionRegistry } from './session/registry'
import { createSessionSpawner } from './spawn-session'

/**
 * Flags that must never consume the following token.
 *
 * What this list protects is a boolean flag followed by a POSITIONAL:
 * `openplc-cli debug open --upload-if-needed ./project` swallows the project
 * path unless `upload-if-needed` is declared here. A boolean followed by another
 * `--flag` is already safe — `parseArgs` treats that as a bare boolean — so
 * testing a new flag that way passes, the declaration gets skipped, and the
 * swallowed-positional bug ships.
 */
const BOOLEAN_FLAGS = [
  'json',
  'quiet',
  'verbose',
  'help',
  'version',
  'clean',
  'yes',
  'upload-if-needed',
  'force-new',
  'keep-forces',
  'keep-going',
  'all',
] as const

const COMMANDS_WITH_SUBCOMMANDS = ['debug'] as const

const USAGE = `openplc-cli — headless OpenPLC Editor

Usage
  openplc-cli create <name> --path <dir> [--type plc-project|plc-library]
                            [--language st|il|ld|sfc|fbd] [--time <interval>]
  openplc-cli create --from-json <file>                     (fixture-friendly form)
  openplc-cli install-cli                                   (put openplc-cli on your PATH)
  openplc-cli devices [--timeout <ms>]
  openplc-cli compile <project> [--target <board>] [--port <serial>] [--clean]
  openplc-cli upload  <project> (--host <address> | --port <serial>) [--target <board>] [--clean] [-y|--yes]
  openplc-cli debug open <project> --target <board> (--host <address> | --port <serial>) [--upload-if-needed]
  openplc-cli debug list
  openplc-cli debug status | list-vars | read | write | force | unforce | start | stop | watch | poll | unwatch
  openplc-cli debug close --session <id> | --all [--keep-forces]
  openplc-cli debug repl [--session <id>]                       (interactive; needs a terminal)
  openplc-cli debug exec [script|-] [--session <id>] [--keep-going]  (one command per line)

Confirmation
  Builds on a device-side target refuse while its PLC is RUNNING, as the editor warns.
  --yes (-y) approves stopping it first, the way 'apt install -y' does.

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
    // stderr, not stdout: in JSON mode stdout carries exactly one JSON document,
    // and prose there breaks `openplc-cli --help | jq` for no benefit — help is a
    // diagnostic, not a result.
    process.stderr.write(`${USAGE}\n`)
    // No command at all is a usage error; asking for help is not.
    // Asking for help succeeds; being given nothing is a usage error, so a
    // script that invokes the CLI with an empty argument does not read as OK.
    const askedForHelp = boolFlag(args, 'help') || args.command === 'help'
    return askedForHelp ? ExitCode.Ok : ExitCode.Usage
  }

  switch (args.command) {
    case 'create':
      return (await runCreate(args, reporter)).exitCode
    case 'devices':
      return (await runDevices(args, reporter)).exitCode
    case 'install-cli':
      return (await runInstallCli(args, reporter)).exitCode
    case 'compile':
      return (await runBuild(args, reporter, { withUpload: false })).exitCode
    case 'upload':
      return (await runBuild(args, reporter, { withUpload: true })).exitCode
    case 'debug':
      return (await runDebug(args, reporter, buildDebugContext())).exitCode
    default:
      // Print the usage as well as the error: a mistyped command is the moment
      // the list of real commands is most useful, and hunting for --help is a
      // pointless second step.
      process.stderr.write(`${USAGE}\n\n`)
      return reporter.failure(
        { code: ErrorCode.UnknownCommand, message: `Unknown command "${args.command}".` },
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
      execArgs: daemonSpawnArgs(),
      uploadProgram: async ({ projectPath, target, host, username, password, port, onLine }) => {
        // A reporter whose progress forwards to the caller and whose result is
        // discarded — `debug open` reports the outcome itself.
        const uploadReporter = new Reporter({
          mode: 'json',
          streams: { out: () => undefined, err: (text) => onLine(text.replace(/\n$/, '')) },
        })
        const result = await buildProject({
          projectPath,
          target,
          host: host || undefined,
          port: port || undefined,
          // Passed structurally, not colon-joined and re-split.
          credentials: host ? { username, password } : undefined,
          withUpload: true,
          // `debug open --upload-if-needed` is already an explicit instruction to
          // put this program on the device, so the stop-PLC consent is implied.
          autoApprove: true,
          reporter: uploadReporter,
        })
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
function daemonSpawnArgs(): string[] {
  // Packaged: the app binary cannot be handed a script — it always runs
  // `package.json.main`. `src/main/entry.ts` dispatches on argv instead, so the
  // marker alone is the whole instruction.
  if (app.isPackaged) return ['--cli-daemon']

  // Dev: Electron was handed this bundle's path, and webpack leaves __filename
  // as the real runtime path (`node: { __filename: false }`).
  const script = process.argv[1] ?? __filename
  if (!script.endsWith('.js')) {
    throw new Error(
      `Cannot locate the CLI bundle to spawn a debug session (resolved "${script}"). ` +
        'Refusing to re-launch, because a non-bundle path starts the editor GUI instead.',
    )
  }
  return [script, '--cli-daemon']
}

/**
 * Make this process able to run without a display.
 *
 * Electron initialises its Ozone platform during startup, before any window
 * exists, and on Linux that means connecting to X11 or Wayland. With neither —
 * a CI runner, a container, an SSH session — it does not degrade, it exits:
 * "Missing X server or $DISPLAY. The platform failed to initialize." So a CLI
 * that never opens a window still cannot start.
 *
 * The `headless` Ozone platform is the supported answer, and asking for it here
 * means callers do not have to wrap every invocation in `xvfb-run`. macOS and
 * Windows have no equivalent problem and are left alone.
 */
function enableHeadlessPlatform(): void {
  if (process.platform !== 'linux') return
  app.commandLine.appendSwitch('ozone-platform', 'headless')
  // A GPU process is pointless for a CLI.
  app.commandLine.appendSwitch('disable-gpu')
  app.disableHardwareAcceleration()
  // Chromium's SUID sandbox refuses to start unless its helper is root-owned
  // and mode 4755, which is not the case inside a container — the exact
  // environment a CI run lives in. Turning it off is safe HERE and only here:
  // this process creates no renderer and loads no web content, so the sandbox
  // has nothing to isolate. The GUI never takes this path.
  app.commandLine.appendSwitch('no-sandbox')
}

async function main(): Promise<void> {
  enableHeadlessPlatform()
  // The daemon's stdout is a handshake channel the parent closes on purpose, so
  // it must survive losing it — see `installNeverHangGuards`.
  const isDaemon = process.argv.includes('--cli-daemon')
  installNeverHangGuards({ exitWhenOutputClosed: !isDaemon })

  // The daemon reads its config from stdin and never parses argv.
  if (isDaemon) {
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

  // Create the editor's user-data scaffolding — settings, history, the
  // arduino-cli config, `User/Runtime/arduino-core-control.json` — exactly as
  // the GUI does at startup. AWAITED, unlike the GUI's fire-and-forget
  // constructor, because a command can reach the compiler in the same tick and
  // the compiler reads that file eagerly. Without it a first run on a clean
  // machine (any CI container) failed with a bare ENOENT.
  //
  // Skipped when there is no command to run. Answering `--help` should not
  // create directories or spawn arduino-cli, and in a container without the
  // toolchain it is the difference between printing the usage and taking a
  // second to do it.
  if (!isMetaOnly(args)) await new UserService().initialize()

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
  await exitAfterOutputDrains(exitCode)
}

/**
 * Does this invocation only ask the CLI to describe ITSELF?
 *
 * `--help`, `--version` and a bare invocation answer from constants alone: no
 * project, no target, no toolchain. Anything else may reach the compiler, so it
 * gets the full user-data scaffolding first.
 */
function isMetaOnly(args: ParsedArgs): boolean {
  return (
    args.command === undefined ||
    args.command === 'help' ||
    args.command === 'version' ||
    boolFlag(args, 'help') ||
    boolFlag(args, 'version')
  )
}

/** `stringFlag` is re-exported for the daemon entry, which shares the parser. */
export { stringFlag }

// `.catch`, not `void`: a rejection here has to become an exit. An Electron main
// process owns no window, so nothing ends it when the promise chain dies — it
// just idles, and the caller waits forever. See `installNeverHangGuards`.
main().catch((error) => {
  writeIfPossible(process.stderr, `openplc-cli: ${error instanceof Error ? error.message : String(error)}\n`)
  app.exit(ExitCode.Internal)
})

/**
 * Exit only once stdout and stderr have actually been written.
 *
 * Node's stdout is ASYNCHRONOUS when it is a pipe on POSIX (synchronous only for
 * files and TTYs) — and `resolveOutputMode` picks JSON mode precisely when
 * stdout is not a TTY, so the machine-readable path is the queued one.
 * `app.exit` discards whatever is still queued, which makes
 * `openplc-cli debug list-vars | jq` truncate deterministically above the ~64 KiB
 * pipe buffer: exactly the "stdout carries one complete JSON document" promise
 * this CLI makes.
 *
 * Waiting for the drain callbacks is bounded, because a reader that never
 * consumes (a closed pipe) would otherwise hang the process forever.
 */
async function exitAfterOutputDrains(code: ExitCodeValue): Promise<void> {
  await Promise.race([
    Promise.all([drain(process.stdout), drain(process.stderr)]),
    new Promise((resolve) => setTimeout(resolve, OUTPUT_DRAIN_TIMEOUT_MS)),
  ])
  app.exit(code)
}

/**
 * Make every failure path end the process.
 *
 * A CLI that hangs is worse than one that fails: a failure is a red step, a
 * hang is a build that burns its job timeout and reports nothing. This process
 * has two ways to hang, and neither is hypothetical — both were reproduced:
 *
 *  1. **A reader that leaves.** `openplc-cli debug list-vars | head -20` closes
 *     the pipe as soon as `head` has its lines, and the next write raises
 *     EPIPE. Node surfaces that as an `error` event on the stream; with no
 *     listener, the reporter's own attempt to report it raises EPIPE in turn,
 *     `main()` rejects, and nothing exits. Exit code `Ok`: the reader asked for
 *     a prefix and got it, so a `pipefail` pipeline must not turn that into a
 *     failed build.
 *
 *  2. **A rejection with no handler.** Anything that throws outside
 *     `dispatch`'s try — including the drain itself — used to leave the app
 *     running with no window and no work.
 *
 * Registered before any command runs, because a command can reach a broken
 * stream on its first line of output.
 */
function installNeverHangGuards(options: { exitWhenOutputClosed: boolean }): void {
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE') {
        app.exit(ExitCode.Internal)
        return
      }
      // A one-shot command has nothing left to say once its reader is gone.
      //
      // A DAEMON does. Its stdout carries the handshake and nothing else, and
      // `spawn-session` destroys that pipe as soon as the session is registered
      // — so the first idle-timeout diagnostic afterwards raises EPIPE on a
      // stream nobody was listening to any more. Exiting there would kill a live
      // session mid-flight, and the forces it was holding would stay pinned on
      // the device: the runtime clears a forced slot when it is told to, not
      // when its debugger disappears. Losing the pipe is expected here, so it is
      // ignored and the session keeps running until something closes it.
      if (options.exitWhenOutputClosed) app.exit(ExitCode.Ok)
    })
  }

  process.on('unhandledRejection', (reason) => {
    writeIfPossible(process.stderr, `openplc-cli: unhandled rejection: ${String(reason)}\n`)
    app.exit(ExitCode.Internal)
  })
  process.on('uncaughtException', (error) => {
    writeIfPossible(process.stderr, `openplc-cli: ${error.message}\n`)
    app.exit(ExitCode.Internal)
  })
}

/**
 * Write a last word if the stream still accepts one.
 *
 * Used only on the paths that are already handling a failure: the stream may be
 * the very thing that failed, and a throw from a handler whose job is to exit
 * would put us back to hanging.
 */
function writeIfPossible(stream: NodeJS.WriteStream, text: string): void {
  try {
    stream.write(text)
  } catch {
    // Nowhere left to report to. The exit code is the whole message.
  }
}

const OUTPUT_DRAIN_TIMEOUT_MS = 5000

/** Resolve when this stream has flushed what is queued. */
function drain(stream: NodeJS.WriteStream): Promise<void> {
  // `write('')` invokes its callback once everything queued ahead of it has been
  // handed to the OS, which is the signal we need and the one `app.exit` skips.
  return new Promise((resolve) => {
    stream.write('', () => resolve())
  })
}
