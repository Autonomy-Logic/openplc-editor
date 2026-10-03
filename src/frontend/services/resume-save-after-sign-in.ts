/**
 * Re-run a save that died because the Edge session ended.
 *
 * The problem this solves is narrow and specific. A save that fails on an expired
 * session leaves the project dirty in memory and nothing on the server. The user
 * then signs in — the modal is right there — and the save is still not done. The
 * only signal was a toast that had already faded, so the normal outcome was
 * assuming the work was stored and closing the tab.
 *
 * So the save is held here and replayed the moment the session works again. The
 * user does not have to notice anything, which is the point: they never asked for
 * their session to expire, and remembering to save twice is not a reasonable thing
 * to ask of them.
 */

import type { EdgeSessionState } from '../../middleware/shared/ports/edge-account-port'
import { openPLCStoreBase } from '../store'

/**
 * The session signals, handed in at boot.
 *
 * Injected rather than imported: this file lives in `frontend/services`, which the
 * architecture rules forbid from importing an adapter — and rightly so, since the
 * desktop editor mirrors this surface and has no Edge session at all. The web
 * adapter cannot import us either (adapters may not depend on services), so the
 * wiring happens at the composition root (`App.tsx`).
 *
 * Undefined until wired, and on platforms that never wire it. Everything below
 * degrades to "nothing is queued", which is the correct behaviour there.
 */
let session: EdgeSessionState | undefined

export function configureSaveResume(state: EdgeSessionState): void {
  session = state
}

/**
 * Whether the Edge session is known to have failed.
 *
 * Re-exported through this module so `save-actions` can ask without importing the
 * adapter itself — same reasoning as above.
 */
export function isSaveBlockedByEndedSession(): boolean {
  return session?.isExpired() ?? false
}

/**
 * Which save is waiting, and what it covers.
 *
 * A project save writes every dirty file, so it supersedes any queued single-file
 * save; a single-file save does NOT supersede a queued project save — letting it
 * would replay one file and leave every other dirty file unwritten, while the toast
 * said the save would finish on its own.
 *
 * A file save must name its file, because two of them for DIFFERENT files do not
 * supersede each other either. That used to be a single slot, so the second Ctrl+S
 * silently evicted the first: the user was told "sign in again and PouA saves on
 * its own", then told the same about PouB, and only PouB was ever written.
 */
export type SaveTarget = { scope: 'project' } | { scope: 'file'; fileName: string }

type QueuedSave = {
  run: () => Promise<unknown>
  /**
   * The project this save was queued for.
   *
   * `run` closes over nothing that identifies it — both variants read the store at
   * replay time — so without this a save queued for one project and replayed after
   * the user opened another wrote whatever happened to be loaded, leaving the edits
   * that were actually queued unsaved. The single-file variant announced it, too:
   * `executeSaveFile('PouA', …)` against a project with no `PouA` toasted
   * `File "PouA" not found` seconds after an unrelated sign-in.
   */
  projectPath: string
}

/** The queued project-wide save, if one is waiting. Excludes the per-file queue. */
let pendingProject: QueuedSave | null = null

/**
 * Queued single-file saves, keyed by project AND file name. Empty whenever
 * `pendingProject` is set.
 */
const pendingFiles = new Map<string, QueuedSave>()

/** Live only while something is actually waiting, so an idle editor holds no listener. */
let unsubscribe: (() => void) | null = null

/** The project currently open, as the store knows it. */
function currentProjectPath(): string {
  return openPLCStoreBase.getState().project.meta.path
}

/**
 * The queue key for a single-file save.
 *
 * Scoped to the project, not just the file. Two projects can each hold a POU of
 * the same name, and keying on the name alone let the second queue call evict the
 * first. If the evicted entry was the one belonging to the project still open at
 * restore, it was gone and the survivor was skipped for a path mismatch — so
 * neither save ran, which is the exact failure a per-file queue exists to prevent.
 *
 * NUL joins the two parts because it cannot occur in a path or a file name, so no
 * two different pairs can collide on one key.
 */
function fileKey(projectPath: string, fileName: string): string {
  return `${projectPath}\u0000${fileName}`
}

export function resumeSaveAfterEdgeSignIn(
  run: () => Promise<unknown>,
  target: SaveTarget = { scope: 'project' },
): void {
  if (!session) {
    return
  }

  const projectPath = currentProjectPath()

  if (target.scope === 'project') {
    // Writes every dirty file, so whatever single files were waiting are covered.
    pendingFiles.clear()
    pendingProject = { run, projectPath }
  } else {
    // A narrower save never displaces a broader one already waiting.
    if (pendingProject) {
      return
    }

    pendingFiles.set(fileKey(projectPath, target.fileName), { run, projectPath })
  }

  // NOT guarded on `session.isExpired()`.
  //
  // There is a narrow window where the session recovers between a save failing
  // and this call, leaving the entry waiting for a restore that already happened.
  // Running immediately instead looks like the fix and is not: a replay that fails
  // again re-registers from inside the restore fan-out, at which point the session
  // is already marked healthy — so "run it now" recurses into the save it was
  // meant to defer. The window is a few microseconds (the caller checks expiry
  // immediately before calling), and losing a queued replay there is strictly
  // better than re-entering the save path.
  unsubscribe ??= session.onRestored(() => {
    const queued = pendingProject ? [pendingProject] : [...pendingFiles.values()]

    // Cleared BEFORE running: a replay can fail again (the session could die a
    // second time), and it has to be free to register itself afresh rather than
    // being cancelled by this teardown.
    pendingProject = null
    pendingFiles.clear()
    unsubscribe?.()
    unsubscribe = null

    void replayQueued(queued)
  })
}

/**
 * Run the queued saves, skipping any that belong to a project no longer open.
 *
 * Sequential rather than concurrent: these write into the same project through the
 * same store, and interleaving two of them is how a half-written project happens.
 */
async function replayQueued(queued: QueuedSave[]): Promise<void> {
  for (const save of queued) {
    // Re-read the open project on every iteration rather than once before the
    // loop. Because the replays are sequential awaits, the user can open another
    // project while an earlier one is still running; a path captured up front
    // would still match, and `run` — which reads the store at the moment it runs,
    // not when it was queued — would write this project's content into that one.
    if (save.projectPath !== currentProjectPath()) {
      continue
    }

    try {
      await save.run()
    } catch {
      // Both save variants report their own failures and neither rejects; caught
      // anyway so one throwing cannot strand the saves queued behind it.
    }
  }
}

/** True while a save is waiting for the session to come back. */
export function hasSaveWaitingForSignIn(): boolean {
  return pendingProject !== null || pendingFiles.size > 0
}

/** Test seam: drop the queued saves, the subscription and the wiring between cases. */
export function resetResumeSaveForTests(state?: EdgeSessionState): void {
  pendingProject = null
  pendingFiles.clear()
  unsubscribe?.()
  unsubscribe = null
  session = state
}
