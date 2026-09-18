/**
 * `openplc-cli install-cli` — put (or refresh) the `openplc-cli` shim on PATH.
 *
 * The GUI does this on first run; this is the explicit form, for a CI image that
 * never launches the GUI and for re-running it after the app moves. Same code
 * path either way.
 */

import { homedir } from 'node:os'
import { resolve } from 'node:path'

import { installCliShim } from '@root/backend/editor/cli-shim/install-shim'
import type { ShimPlatform } from '@root/backend/editor/cli-shim/shim-plan'
import { app } from 'electron'

import type { ParsedArgs } from '../args'
import { ErrorCode, ExitCode } from '../exit-codes'
import type { CliResult, Reporter } from '../output'

export async function runInstallCli(_args: ParsedArgs, reporter: Reporter): Promise<CliResult> {
  const platform = currentPlatform()
  if (!platform) {
    return reporter.failure(
      { code: ErrorCode.Internal, message: `Unsupported platform "${process.platform}"` },
      ExitCode.Internal,
    )
  }

  const result = await installCliShim({
    appBinaryPath: process.execPath,
    leadingArgs: cliLeadingArgs(),
    // Carried forward only if THIS invocation needed it. A caller in a container
    // whose sandbox cannot start passes `--no-sandbox` once, to install, and gets
    // a shim that keeps working; a desktop install keeps the sandbox on.
    sandboxDisabled: process.argv.includes('--no-sandbox'),
    environment: {
      platform,
      home: homedir(),
      pathVariable: process.env.PATH ?? '',
      localAppData: process.env.LOCALAPPDATA,
      // Set by the AppImage runtime to the path of the .AppImage file itself,
      // which is stable — unlike the mount point `process.execPath` reports.
      appImagePath: process.env.APPIMAGE,
    },
    // Explicit invocation means "make it so", so an identical existing shim is
    // rewritten rather than reported as a no-op.
    force: true,
    onDiagnostic: (message) => reporter.progress(message),
  })

  switch (result.status) {
    case 'installed':
    case 'unchanged':
      return reporter.success(
        { shimPath: result.shimPath, onPath: result.onPath, hint: result.hint },
        () => `openplc-cli installed at ${result.shimPath}${result.hint ? `\n\n${result.hint}` : ''}`,
      )
    case 'skipped':
      // Not a failure of the command: the app is somewhere a shim cannot point
      // at, and the message says what to do about it.
      return reporter.failure({ code: ErrorCode.InvalidArgument, message: result.reason }, ExitCode.Usage)
    case 'failed':
      return reporter.failure({ code: ErrorCode.Internal, message: result.reason }, ExitCode.Internal)
    default: {
      // Exhaustiveness: a new `InstallShimResult` status becomes a compile error
      // here rather than this function returning undefined while its type
      // promises a `CliResult`.
      const unreachable: never = result
      return unreachable
    }
  }
}

/** Narrow `process.platform` to the three the shim supports. */
function currentPlatform(): ShimPlatform | undefined {
  if (process.platform === 'darwin' || process.platform === 'linux' || process.platform === 'win32') {
    return process.platform
  }
  return undefined
}

/**
 * What the shim must pass before the user's arguments.
 *
 * A packaged build dispatches on `--cli` inside its own binary. A development
 * build is Electron plus a script, and the script path has to be repeated or the
 * shim launches plain Electron — which answers `--version` with Electron's own
 * and looks like it worked.
 */
function cliLeadingArgs(): string[] {
  if (app.isPackaged) return ['--cli']

  // The script is NOT reliably `argv[1]`. On Linux the entry point re-execs
  // itself with the headless Chromium switches ahead of everything else (see
  // `relaunchForLinuxCli`), so by the time this runs the bundle has been pushed
  // down the list and `argv[1]` is `--no-sandbox`. Reading the fixed position
  // there produced a shim with no script at all — `electron --cli "$@"` — which
  // fails the worst possible way: Electron handed no script HANGS rather than
  // erroring, so the installed command would sit forever instead of saying what
  // was wrong.
  //
  // Absolutised because the argument is whatever the caller typed, often
  // relative (`./openplc-cli.dev.js`), and a shim carrying a relative path only
  // works from the directory it was installed from — exactly what a shim on
  // PATH is meant to free you from.
  const script = process.argv.slice(1).find((argument) => argument.endsWith('.js'))
  return script ? [resolve(script), '--cli'] : ['--cli']
}
