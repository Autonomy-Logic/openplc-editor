/**
 * Installing the `openplc-cli` shim once, on first run.
 *
 * Kept separate from `installCliShim` because "should we do this at all right
 * now" is a different question from "how". Two things it owns:
 *
 *   - **Idempotence across launches.** A marker file records what was installed
 *     and for which app path, so a normal launch does no filesystem work and a
 *     MOVED app (dragged from the disk image to Applications, say) re-installs
 *     rather than leaving a shim pointing at a path that no longer exists.
 *   - **Telling the user when it could not.** The disk-image case is the one
 *     where the user has to act, and silence there means an `openplc-cli` that
 *     never appears with no explanation.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { installCliShim, type InstallShimResult } from './install-shim'
import type { ShimEnvironment } from './shim-plan'

/** What the last attempt did, so a later launch can tell whether to redo it. */
interface ShimState {
  /** The app path the installed shim points at. */
  target: string
  shimPath: string
  installedAt: string
}

export interface FirstRunOptions {
  /** `userData/User/cli-shim.json` normally; injected for tests. */
  statePath: string
  appBinaryPath: string
  /** See `InstallShimOptions.leadingArgs`. */
  leadingArgs: string[]
  environment: ShimEnvironment & { appImagePath?: string }
  /** Shown only when the user has to act (running from a disk image). */
  warn: (message: string) => void
  onDiagnostic?: (message: string) => void
}

export type FirstRunOutcome = InstallShimResult | { status: 'already-current'; shimPath: string }

export async function ensureCliShimInstalled(options: FirstRunOptions): Promise<FirstRunOutcome> {
  const previous = readState(options.statePath)
  const expectedTarget = options.environment.appImagePath ?? options.appBinaryPath

  // Nothing to do: the recorded shim points at this same app and is still there.
  if (previous && previous.target === expectedTarget && existsSync(previous.shimPath)) {
    return { status: 'already-current', shimPath: previous.shimPath }
  }

  const result = await installCliShim({
    appBinaryPath: options.appBinaryPath,
    leadingArgs: options.leadingArgs,
    environment: options.environment,
    onDiagnostic: options.onDiagnostic,
  })

  if (result.status === 'installed' || result.status === 'unchanged') {
    writeState(options.statePath, {
      target: expectedTarget,
      shimPath: result.shimPath,
      installedAt: new Date().toISOString(),
    })
    return result
  }

  // `skipped` is the actionable case — the app is somewhere a shim cannot point
  // at (a mounted disk image, a translocated copy). Deliberately NOT recorded,
  // so moving the app to Applications retries on the next launch.
  if (result.status === 'skipped') options.warn(result.reason)
  return result
}

function readState(path: string): ShimState | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'))
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const record: Record<string, unknown> = { ...parsed }
    if (typeof record.target !== 'string' || typeof record.shimPath !== 'string') return undefined
    return {
      target: record.target,
      shimPath: record.shimPath,
      installedAt: typeof record.installedAt === 'string' ? record.installedAt : '',
    }
  } catch {
    return undefined
  }
}

function writeState(path: string, state: ShimState): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf-8')
  } catch {
    // A missing marker only costs a redundant install next launch, which is
    // idempotent — not worth failing a launch over.
  }
}

/** Where the marker lives, given the app's userData directory. */
export function shimStatePath(userDataPath: string): string {
  return join(userDataPath, 'User', 'cli-shim.json')
}
