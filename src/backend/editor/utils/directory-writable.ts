/**
 * "Could we create files in this directory?" — one answer, two callers.
 *
 * Lifted out of `cli-shim/install-shim` when `openplc-cli create` needed the same
 * question: is the destination the caller named actually writable? Both had the
 * same three awkward details to get right (an absent directory is judged by its
 * nearest existing ancestor; `access(W_OK)` lies on some network filesystems; the
 * probe file must be cleaned up), and two copies of that would drift.
 */

import { existsSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

/**
 * Could we create files here?
 *
 * Probes WITHOUT creating the directory when it does not exist: `planShimInstall`
 * asks about every candidate, so creating them made an install grow both
 * `~/.local/bin` and `~/bin` even though it uses one — contradicting the policy
 * note that says the second exists only for users who already have it. An absent
 * directory is judged by whether its PARENT would allow creating it.
 */
export function directoryIsWritable(directory: string): boolean {
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
