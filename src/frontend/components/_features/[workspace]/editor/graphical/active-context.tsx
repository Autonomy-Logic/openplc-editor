// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Per-instance context for graphical editors.
 *
 * Multi-mount keeps every open POU's graphical editor (FBD / LD /
 * SFC) alive across tab switches, so components deep inside the
 * ReactFlow tree can't trust the *global* `state.editor` — that's
 * whichever POU is currently visible, not the one their host editor
 * was instantiated for.  This context publishes the two pieces of
 * "who am I bound to?" metadata the wrappers know but custom nodes
 * can't easily get via props (ReactFlow controls instantiation):
 *
 *   - `pouName` — the POU this editor instance was mounted for.
 *     Use `useBoundPou()` to read it, then look up your own POU,
 *     flow, and editor model from the store instead of the active
 *     editor.  Without this, every multi-mounted block / variable /
 *     connection effect would see the wrong POU on cross-tab
 *     mutations and either no-op silently or log "node not found"
 *     spam to the console.
 *   - `isActive` — whether this editor is the user's currently-
 *     visible tab.  Used by debug badges and any other "only render
 *     on the focused editor" affordance to short-circuit work on
 *     hidden mounts.  Read with `useIsGraphicalEditorActive()`.
 *
 * Default `{ pouName: '', isActive: true }` exists for tests /
 * isolated stories — under a real provider both fields are set.
 */

import { createContext, type ReactNode, useContext } from 'react'

import { useOpenPLCStore } from '../../../../../store'
import type { EditorModel } from '../../../../../store/slices/editor'
import { selectEditorForPou } from '../../../../../store/slices/editor/utils'

type GraphicalEditorContextValue = {
  pouName: string
  isActive: boolean
}

const GraphicalEditorContext = createContext<GraphicalEditorContextValue>({ pouName: '', isActive: true })

export function GraphicalEditorActiveProvider({
  pouName,
  isActive,
  children,
}: {
  pouName: string
  isActive: boolean
  children: ReactNode
}) {
  return <GraphicalEditorContext.Provider value={{ pouName, isActive }}>{children}</GraphicalEditorContext.Provider>
}

/**
 * Read the POU name this graphical editor instance is bound to.
 * Components mounted under a `GraphicalEditorActiveProvider` should
 * use this instead of `state.editor.meta.name` so cross-tab store
 * mutations don't fire effects against the wrong POU.
 */
export function useBoundPou(): string {
  return useContext(GraphicalEditorContext).pouName
}

/**
 * Read the current graphical editor's active state.  Used by debug
 * badges (and any future per-tab affordance) to short-circuit work
 * when their host editor is hidden.
 */
export function useIsGraphicalEditorActive(): boolean {
  return useContext(GraphicalEditorContext).isActive
}

/**
 * Read the editor model bound to this graphical editor instance.
 * Thin wrapper over the shared `selectEditorForPou` selector — see
 * that helper for the lookup rule.
 */
export function useBoundEditorModel(): EditorModel {
  const pouName = useBoundPou()
  return useOpenPLCStore((s) => selectEditorForPou(s, pouName))
}
