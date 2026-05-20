// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Active-tab context for graphical editors.
 *
 * Multi-mount keeps every open POU's graphical editor (FBD / LD /
 * SFC) alive across tab switches, but per-tab debug badges and any
 * other "only render for the user's currently-visible POU" affordance
 * should still suppress themselves on hidden tabs.  Components deep
 * inside ReactFlow's tree don't have a clean prop path back up to
 * the wrapper, so the wrapper publishes the active flag through this
 * lightweight context.
 *
 * Default `true` is intentional: components that read the context
 * without a provider above them (tests, isolated stories) behave as
 * if they're the only / active editor.
 */

import { createContext, type ReactNode, useContext } from 'react'

const GraphicalEditorActiveContext = createContext<boolean>(true)

export function GraphicalEditorActiveProvider({
  isActive,
  children,
}: {
  isActive: boolean
  children: ReactNode
}) {
  return (
    <GraphicalEditorActiveContext.Provider value={isActive}>
      {children}
    </GraphicalEditorActiveContext.Provider>
  )
}

/**
 * Read the current graphical editor's active state.  Used by debug
 * badges (and any future per-tab affordance) to short-circuit work
 * when their host editor is hidden.
 */
export function useIsGraphicalEditorActive(): boolean {
  return useContext(GraphicalEditorActiveContext)
}
