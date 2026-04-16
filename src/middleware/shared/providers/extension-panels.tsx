/**
 * Extension Panel Provider — optional UI component injection.
 *
 * Platforms provide React components for optional panels (e.g. AI Chat)
 * via this context. Shared code reads from the context and conditionally
 * renders them. When no provider is present, all slots return null.
 *
 * Web: Wraps with ExtensionPanelProvider and provides AIChatPanel.
 * Editor: Does not wrap — useChatPanel() returns null by default.
 */

import { type ComponentType, createContext, type ReactNode, useContext } from 'react'

interface ExtensionPanels {
  ChatPanel: ComponentType | null
}

const defaultPanels: ExtensionPanels = {
  ChatPanel: null,
}

const ExtensionPanelContext = createContext<ExtensionPanels>(defaultPanels)

interface ExtensionPanelProviderProps {
  panels: ExtensionPanels
  children: ReactNode
}

export function ExtensionPanelProvider({ panels, children }: ExtensionPanelProviderProps) {
  return <ExtensionPanelContext.Provider value={panels}>{children}</ExtensionPanelContext.Provider>
}

/** Returns the platform-injected ChatPanel component, or null if not available. */
export function useChatPanel(): ComponentType | null {
  return useContext(ExtensionPanelContext).ChatPanel
}
