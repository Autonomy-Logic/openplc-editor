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
import { dirname, join } from 'node:path'
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
  /** See `ShimInvocation.sandboxDisabled`. */
  sandboxDisabled?: boolean
  environment: ShimEnvironment & { appImagePath?: string }
  /** Write even when a same-content shim already exists. */
  force?: boolean
  onDiagnostic?: (message: string) => void
}

/**
 * Could we create files here?
 *
 * Probes WITHOUT creating the directory when it does not exist: `planShimInstall`
 * asks about every candidate, so creating them made an install grow both
 * `~/.local/bin` and `~/bin` even though it uses one — contradicting the policy
 * note that says the second exists only for users who already have it. An absent
 * directory is judged by whether its PARENT would allow creating it.
 */
function directoryIsWritable(directory: string): boolean {
  if (existsSync(directory)) return canWriteInto(directory)

  // Walk to the nearest ancestor that exists and ask there. Testing only the
  // immediate parent judged `~/.local/bin` unwritable on a machine with no
  // `~/.local` at all — which handed the install to `~/bin` and quietly
  // abandoned the XDG-conventional location the policy prefers.
  let ancestor = dirname(directory)
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor)
    if (parent === ancestor) return false
    ancestor = parent
  }
  return canWriteInto(ancestor)
}

/** Probe by writing, since `access(W_OK)` lies on some network filesystems. */
function canWriteInto(directory: string): boolean {
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

  // Created here, once, for the directory actually chosen.
  try {
    mkdirSync(plan.directory, { recursive: true })
  } catch (error) {
    return {
      status: 'failed',
      reason: `Could not create ${plan.directory}: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  const contents = renderShim(
    { command: target, leadingArgs: options.leadingArgs, sandboxDisabled: options.sandboxDisabled },
    environment.platform,
  )
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
 *
 * The directory is EMBEDDED in the script as a quoted literal rather than passed
 * as a trailing argument. `powershell -Command <script> <arg>` does not populate
 * `$args` — that only happens with `-File` — so an earlier version read
 * `$args[0]` as empty, silently added nothing, and reported success. Embedding
 * has no such failure mode, and single-quoted PowerShell strings have exactly one
 * escape to get right: a literal `'` is doubled.
 */
async function appendToWindowsUserPath(directory: string): Promise<void> {
  // Deliberately a flat sequence of statements with no multi-statement block:
  // the pieces are joined with `; `, and a brace-delimited body would put a
  // separator immediately after `{`. `-Command` (not `-File`) also matters —
  // running a .ps1 is subject to the execution policy, which blocks it by
  // default on a stock Windows install, while `-Command` is not.
  const script = [
    `$dir = ${toPowerShellLiteral(directory)}`,
    "$current = [Environment]::GetEnvironmentVariable('Path', 'User')",
    "if (-not $current) { $current = '' }",
    "$entries = @($current.Split(';') | Where-Object { $_ -ne '' })",
    "if ($entries -notcontains $dir) { [Environment]::SetEnvironmentVariable('Path', (($entries + $dir) -join ';'), 'User') }",
  ].join('; ')

  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
}

/**
 * A PowerShell single-quoted string literal.
 *
 * Single quotes so nothing inside is expanded — a directory containing `$` must
 * not become a variable reference — with the one required escape: `'` doubled.
 */
export function toPowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}
