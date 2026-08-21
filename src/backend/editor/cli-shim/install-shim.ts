/**
 * Installing the `openplc-cli` shim.
 *
 * The policy is in `shim-plan.ts` (pure); this is the filesystem and the
 * Windows PATH edit. Two rules shape it:
 *
 *   - **Never elevate.** A first-run install that asks for an admin password
 *     gets declined, and an IDE should not need root to add a convenience
 *     command. Everything here works as the logged-in user or reports why it
 *     could not.
 *   - **Never surprise.** An existing `openplc-cli` that is not ours is left
 *     alone, and on POSIX we do not edit shell profiles — we print the one line
 *     the user can add themselves.
 */

import { execFile } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

import {
  describeUnstableLocation,
  mayReplace,
  pathHint,
  planShimInstall,
  renderShim,
  resolveShimTarget,
  type ShimEnvironment,
} from './shim-plan'

const run = promisify(execFile)

export type InstallShimResult =
  | { status: 'installed'; shimPath: string; onPath: boolean; hint?: string }
  | { status: 'unchanged'; shimPath: string; onPath: boolean; hint?: string }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string }

export interface InstallShimOptions {
  /** The running app executable. On a Linux AppImage this is the mount point,
   *  and `environment.appImagePath` supersedes it — see `resolveShimTarget`. */
  appBinaryPath: string
  /**
   * Arguments the shim must pass before the user's own. `['--cli']` for a
   * packaged build; a development build also needs its script path first, or the
   * shim runs plain Electron.
   */
  leadingArgs: string[]
  environment: ShimEnvironment & { appImagePath?: string }
  /** Write even when a same-content shim already exists. */
  force?: boolean
  onDiagnostic?: (message: string) => void
}

/** Can we create files here? Tested by creating the directory, not by guessing at modes. */
function directoryIsWritable(directory: string): boolean {
  try {
    mkdirSync(directory, { recursive: true })
  } catch {
    return false
  }
  // `access(W_OK)` lies on some network and container filesystems, so probe by
  // actually writing — the only answer that matters is whether a write works.
  const probe = join(directory, `.openplc-cli-probe-${process.pid}`)
  try {
    writeFileSync(probe, '')
    return true
  } catch {
    return false
  } finally {
    try {
      rmSync(probe, { force: true })
    } catch {
      /* the probe is disposable */
    }
  }
}

export async function installCliShim(options: InstallShimOptions): Promise<InstallShimResult> {
  const { appBinaryPath, environment } = options
  const diagnostic = options.onDiagnostic ?? (() => undefined)

  // What the shim will actually invoke: the AppImage FILE on Linux when the
  // runtime told us where it is, otherwise the running executable.
  const target = resolveShimTarget(appBinaryPath, environment)

  const unstable = describeUnstableLocation(target, environment.platform)
  if (unstable) return { status: 'skipped', reason: unstable }

  const plan = planShimInstall(environment, { isWritable: directoryIsWritable })
  if (!plan) {
    return {
      status: 'failed',
      reason:
        'No writable directory was found for the openplc-cli command. Tried: ' +
        `${candidatesFor(environment).join(', ')}.`,
    }
  }

  const contents = renderShim({ command: target, leadingArgs: options.leadingArgs }, environment.platform)
  const existing = existsSync(plan.shimPath) ? readSafely(plan.shimPath) : undefined

  if (!mayReplace(existing)) {
    return {
      status: 'skipped',
      reason:
        `${plan.shimPath} already exists and was not created by OpenPLC Editor, so it was left untouched. ` +
        'Remove it and restart if you want the editor to manage it.',
    }
  }

  if (existing === contents && !options.force) {
    const hint = await ensureOnPath(plan, environment, diagnostic)
    return { status: 'unchanged', shimPath: plan.shimPath, onPath: plan.onPath, hint }
  }

  try {
    writeFileSync(plan.shimPath, contents, 'utf-8')
    // 0o755: executable by everyone, writable only by the owner. Windows infers
    // executability from the .cmd extension and has no mode to set.
    if (environment.platform !== 'win32') chmodSync(plan.shimPath, 0o755)
  } catch (error) {
    return {
      status: 'failed',
      reason: `Could not write ${plan.shimPath}: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  const hint = await ensureOnPath(plan, environment, diagnostic)
  diagnostic(`Installed openplc-cli at ${plan.shimPath}`)
  return { status: 'installed', shimPath: plan.shimPath, onPath: plan.onPath, hint }
}

function candidatesFor(environment: ShimEnvironment): string[] {
  // Re-derived for the message only; `planShimInstall` already probed them.
  return environment.platform === 'win32'
    ? [`${environment.localAppData ?? environment.home}\\Programs\\openplc-cli`]
    : [`${environment.home}/.local/bin`, `${environment.home}/bin`]
}

function readSafely(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return undefined
  }
}

/**
 * Put the directory on PATH where the platform allows it.
 *
 * Windows has a per-user PATH we can edit; POSIX PATH comes from the user's
 * shell profile, and editing someone's `.zshrc` unasked is not an install step —
 * so there we return the line for them to add.
 */
async function ensureOnPath(
  plan: ReturnType<typeof planShimInstall> & object,
  environment: ShimEnvironment,
  diagnostic: (message: string) => void,
): Promise<string | undefined> {
  if (plan.onPath) return undefined
  if (environment.platform !== 'win32') return pathHint(plan, environment.platform)

  try {
    await appendToWindowsUserPath(plan.directory)
    diagnostic(`Added ${plan.directory} to the user PATH`)
    return pathHint(plan, environment.platform)
  } catch (error) {
    return (
      `Installed the command, but could not add ${plan.directory} to your PATH ` +
      `(${error instanceof Error ? error.message : String(error)}). Add it manually.`
    )
  }
}

/**
 * Append a directory to the *user* PATH on Windows.
 *
 * PowerShell's `SetEnvironmentVariable`, deliberately not `setx`: setx truncates
 * the value at 1024 characters, and a developer's PATH is routinely longer than
 * that — it would silently destroy entries. Reads the current user-scope value
 * (not the process one, which is the user and machine values already merged) so
 * the machine PATH is never copied into the user's.
 */
async function appendToWindowsUserPath(directory: string): Promise<void> {
  const script = [
    '$dir = $args[0]',
    "$current = [Environment]::GetEnvironmentVariable('Path', 'User')",
    "if ([string]::IsNullOrEmpty($current)) { $current = '' }",
    "$entries = $current.Split(';') | Where-Object { $_ -ne '' }",
    'if ($entries -notcontains $dir) {',
    "  $updated = (@($entries) + $dir) -join ';'",
    "  [Environment]::SetEnvironmentVariable('Path', $updated, 'User')",
    '}',
  ].join('; ')

  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script, directory])
}
