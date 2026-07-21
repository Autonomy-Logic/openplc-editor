import { zodFBDFlowSchema } from '../fbd'
import { zodLadderFlowSchema } from '../ladder'
import type { SharedRootState } from './types'

/**
 * Write-back of graphical flow state (ladder / FBD) into
 * `project.data.pous[].body.value`.
 *
 * The flow slices (`ladderFlows` / `fbdFlows`) are the on-screen source of
 * truth — the canvas renders directly from them and every edit updates them
 * synchronously. The POU `body` is a projection that must be re-derived from
 * the flow before it is read by anything that persists or compiles. Two paths
 * keep it in sync:
 *
 *   - `scheduleFlowWriteBack` — a debounced, per-POU write during editing.
 *     Purely a responsiveness/UX optimization (keeps the body roughly current
 *     for the diff view, undo snapshots, dirty tracking). It is gated on the
 *     transient `flow.updated` flag and is NOT relied on for correctness.
 *   - `flushFlowWriteBacks` — an UNCONDITIONAL, content-based flush used at
 *     the critical save / compile boundary. It ignores `flow.updated` and any
 *     pending timer and copies the current flow(s) straight into the body, so
 *     what goes to disk / S3 and what is handed to the transpiler is exactly
 *     what is on the canvas. This is the correctness guarantee.
 *
 * Why the flush must be unconditional: `flow.updated` is a boolean edge that
 * write-back scheduling (a React effect) and the post-save reset both toggle.
 * An edit could set the flag, have its scheduled write-back cleared by a
 * concurrent save's reset, and be stranded on the canvas but never written to
 * the body — the compiler then sees pre-edit graphics. Making the save/compile
 * flush ignore the flag removes that entire class of race by construction.
 *
 * `writeFlowToBody` persists the RAW flow object (minus the transient
 * `updated` flag) — see DOPE-477. `sanitizePou` normalizes selection/viewport
 * state at serialize time, so re-flushing an unchanged POU is byte-identical
 * and never produces a phantom "Modified" in Source Control.
 */

export const FLOW_WRITEBACK_DEBOUNCE_MS = 200

type FlowLanguage = 'ld' | 'fbd'
type GetWriteBackState = () => SharedRootState

const pendingWriteBacks = new Map<string, { language: FlowLanguage; timer: ReturnType<typeof setTimeout> }>()

/**
 * Copy one POU's current flow into its project body — UNCONDITIONALLY, without
 * gating on `flow.updated`. Persists the raw flow object (minus the transient
 * `updated` flag); a zod parse guards against writing a malformed flow (in
 * which case the flow is left dirty so a later pass can retry).
 */
function writeFlowToBody(getState: GetWriteBackState, pouName: string, language: FlowLanguage): void {
  const state = getState()
  const flow =
    language === 'ld'
      ? state.ladderFlows.find((f) => f.name === pouName)
      : state.fbdFlows.find((f) => f.name === pouName)
  if (!flow) return

  // Validate with zod but persist the raw object (minus the transient
  // `updated` flag). Using the parsed result would silently strip every
  // field not declared in the schema and reorder keys to schema order,
  // byte-drifting the serialized POU vs. the loaded disk copy — phantom
  // "Modified" entries in Source Control (see DOPE-477).
  const schema = language === 'ld' ? zodLadderFlowSchema : zodFBDFlowSchema
  if (!schema.safeParse(flow).success) return

  const { updated: _updated, ...flowBody } = flow
  state.projectActions.updatePou({ name: pouName, content: { language, value: flowBody } })

  const flowActions = language === 'ld' ? state.ladderFlowActions : state.fbdFlowActions
  flowActions.setFlowUpdated({ editorName: pouName, updated: false })
}

/**
 * The debounced write-back body. Gated on `flow.updated` purely as an
 * optimization: a flush or undo/redo that already cleared the flag makes this
 * a no-op. Correctness does not depend on it — `flushFlowWriteBacks` does.
 */
function runScheduledWriteBack(getState: GetWriteBackState, pouName: string, language: FlowLanguage): void {
  const state = getState()
  const flow =
    language === 'ld'
      ? state.ladderFlows.find((f) => f.name === pouName)
      : state.fbdFlows.find((f) => f.name === pouName)
  if (!flow?.updated) return
  writeFlowToBody(getState, pouName, language)
}

/**
 * Mark the POU dirty now and queue its debounced write-back. Edits landing
 * while a timer is pending coalesce into it — the executor reads the store at
 * fire time, so it always persists the latest flow.
 */
export function scheduleFlowWriteBack(getState: GetWriteBackState, pouName: string, language: FlowLanguage): void {
  const state = getState()
  // Dirty-marking keeps its immediate, per-edit timing; only the expensive
  // updatePou is deferred. The debugger drives node values through the same
  // flow state without making the file unsaved, hence the gate.
  if (!state.workspace.isDebuggerVisible) {
    state.sharedWorkspaceActions.handleFileAndWorkspaceSavedState(pouName)
  }
  if (pendingWriteBacks.has(pouName)) return
  const timer = setTimeout(() => {
    pendingWriteBacks.delete(pouName)
    runScheduledWriteBack(getState, pouName, language)
  }, FLOW_WRITEBACK_DEBOUNCE_MS)
  pendingWriteBacks.set(pouName, { language, timer })
}

/**
 * Unconditionally flush graphical flow(s) into the project body — every flow,
 * or a single POU's when `pouName` is given. Cancels any pending debounced
 * timers for the targeted POU(s) first (they'd be redundant), then writes the
 * current flow content regardless of the `updated` flag. Call this at every
 * save / compile boundary so persisted / compiled bytes always match the
 * canvas, for all graphical languages.
 */
export function flushFlowWriteBacks(getState: GetWriteBackState, pouName?: string): void {
  // Cancel in-flight debounced timers for the targeted POU(s) so they can't
  // fire redundantly after this pass.
  for (const [name, pending] of [...pendingWriteBacks]) {
    if (pouName !== undefined && name !== pouName) continue
    clearTimeout(pending.timer)
    pendingWriteBacks.delete(name)
  }

  const state = getState()
  const targets: Array<{ name: string; language: FlowLanguage }> = [
    ...state.ladderFlows.map((flow) => ({ name: flow.name, language: 'ld' as const })),
    ...state.fbdFlows.map((flow) => ({ name: flow.name, language: 'fbd' as const })),
  ]
  for (const target of targets) {
    if (pouName !== undefined && target.name !== pouName) continue
    writeFlowToBody(getState, target.name, target.language)
  }
}

/** Drop pending write-backs without running them (project open). */
export function cancelFlowWriteBacks(pouName?: string): void {
  for (const [name, pending] of [...pendingWriteBacks]) {
    if (pouName !== undefined && name !== pouName) continue
    clearTimeout(pending.timer)
    pendingWriteBacks.delete(name)
  }
}
