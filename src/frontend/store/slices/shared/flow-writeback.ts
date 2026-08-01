import { zodFBDFlowSchema } from '../fbd'
import { zodLadderFlowSchema } from '../ladder'
import type { SharedRootState } from './types'

/**
 * Debounced write-back of graphical flow state (ladder / FBD) into
 * `project.data.pous[].body.value`.
 *
 * Every graphical edit used to trigger an immediate whole-flow
 * `structuredClone` into the project slice (plus a monaco-model-sync sweep
 * per write). Edits inside the debounce window now coalesce into a single
 * write-back that persists the flow **by reference** — the store is
 * immer-managed (frozen, copy-on-write), so the project copy and the live
 * flow safely share structure.
 *
 * A pending timer means `pou.body.value` is momentarily stale, so the rest
 * of the app must cooperate:
 *   - save paths call `flushFlowWriteBacks` before serializing, so a save
 *     landing inside the debounce window still persists the fresh body;
 *   - undo/redo and snapshot capture flush the affected POU so a history
 *     entry never pairs a stale body with a fresh flow;
 *   - project open cancels pending timers outright — a write-back scheduled
 *     against the previous project must not fire into the new one.
 *
 * Execution re-reads the store at fire time and is guarded on
 * `flow.updated`, so a flush after save/undo already cleared the flag is a
 * no-op.
 */

export const FLOW_WRITEBACK_DEBOUNCE_MS = 200

type FlowLanguage = 'ld' | 'fbd'
type GetWriteBackState = () => SharedRootState

const pendingWriteBacks = new Map<string, { language: FlowLanguage; timer: ReturnType<typeof setTimeout> }>()

/** @returns `false` when the flow is invalid and `pou.body.value` is left stale. */
function runWriteBack(getState: GetWriteBackState, pouName: string, language: FlowLanguage): boolean {
  const state = getState()
  const flow =
    language === 'ld'
      ? state.ladderFlows.find((f) => f.name === pouName)
      : state.fbdFlows.find((f) => f.name === pouName)
  if (!flow?.updated) return true

  // Validate with zod but persist the raw object (minus the transient
  // `updated` flag). Using the parsed result would silently strip every
  // field not declared in the schema and reorder keys to schema order,
  // byte-drifting the serialized POU vs. the loaded disk copy — phantom
  // "Modified" entries in Source Control (see DOPE-477).
  const schema = language === 'ld' ? zodLadderFlowSchema : zodFBDFlowSchema
  const validation = schema.safeParse(flow)
  if (!validation.success) {
    console.warn(`[flow-writeback] "${pouName}" (${language}) failed validation — body left stale`, {
      issues: validation.error.issues,
    })
    return false
  }

  const { updated: _updated, ...flowBody } = flow
  state.projectActions.updatePou({ name: pouName, content: { language, value: flowBody } })

  const flowActions = language === 'ld' ? state.ladderFlowActions : state.fbdFlowActions
  flowActions.setFlowUpdated({ editorName: pouName, updated: false })
  return true
}

/**
 * Mark the POU dirty now and queue its write-back. Edits landing while a
 * timer is pending coalesce into it — the executor reads the store at fire
 * time, so it always persists the latest flow.
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
    runWriteBack(getState, pouName, language)
  }, FLOW_WRITEBACK_DEBOUNCE_MS)
  pendingWriteBacks.set(pouName, { language, timer })
}

/**
 * Run pending write-backs immediately — all of them, or a single POU's.
 *
 * Every `updated` flow is written back, not just the ones with a live timer:
 * a timer that already fired and failed validation leaves no pending entry
 * behind, so a pending-only sweep would report success for a POU whose body
 * is still stale (DOPE-495).
 *
 * @returns names of POUs whose body could not be updated.
 */
export function flushFlowWriteBacks(getState: GetWriteBackState, pouName?: string): string[] {
  cancelFlowWriteBacks(pouName)

  const state = getState()
  const failed: string[] = []
  for (const flow of state.ladderFlows) {
    if (pouName !== undefined && flow.name !== pouName) continue
    if (flow.updated && !runWriteBack(getState, flow.name, 'ld')) failed.push(flow.name)
  }
  for (const flow of state.fbdFlows) {
    if (pouName !== undefined && flow.name !== pouName) continue
    if (flow.updated && !runWriteBack(getState, flow.name, 'fbd')) failed.push(flow.name)
  }
  return failed
}

/** Drop pending write-backs without running them (project open). */
export function cancelFlowWriteBacks(pouName?: string): void {
  for (const [name, pending] of [...pendingWriteBacks]) {
    if (pouName !== undefined && name !== pouName) continue
    clearTimeout(pending.timer)
    pendingWriteBacks.delete(name)
  }
}
