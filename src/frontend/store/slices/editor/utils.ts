import type { EditorModel, EditorState } from './types'

/**
 * Resolve the editor model bound to `pouName` from the editor slice
 * state.  Multi-mount keeps every open POU's editor live in
 * `state.editors[]`; consumers (graphical editor bodies, the
 * variables editor, etc.) need each instance to read ITS OWN model
 * — not the globally-active one — so cross-tab store mutations
 * don't accidentally rebind them to whichever POU happens to be
 * focused.
 *
 *   - When the bound POU IS the active editor we return
 *     `state.editor`: it's the fresh copy that action callsites
 *     mutate, so reactive selectors see the update immediately.
 *   - For hidden POUs we return the snapshot from `state.editors[]`.
 *   - When `pouName` is missing or doesn't match anything (tests,
 *     stories rendered outside a provider) we fall back to the
 *     active editor.
 *
 * The two non-trivial consumers (`useBoundEditorModel` in
 * `active-context.tsx`, the `editor` selector in
 * `VariablesEditor`) used to inline this lookup independently; the
 * shared helper exists so they can't drift.
 */
export function selectEditorForPou(state: EditorState, pouName: string | undefined): EditorModel {
  if (!pouName) return state.editor
  if (state.editor.meta.name === pouName) return state.editor
  return state.editors.find((e) => e.meta.name === pouName) ?? state.editor
}
