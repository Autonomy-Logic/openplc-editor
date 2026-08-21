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
  const script = process.argv[1]
  // Absolutised: argv[1] is whatever the caller typed, often relative
  // (`./openplc-cli.dev.js`). A shim carrying a relative path only works from
  // the directory it was installed from — which is exactly what a shim on PATH
  // is meant to free you from, and it fails by HANGING rather than erroring
  // (Electron given a missing script waits instead of exiting).
  return script && script.endsWith('.js') ? [resolve(script), '--cli'] : ['--cli']
}
