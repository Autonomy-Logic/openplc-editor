import { Bug, type LucideIcon, ScrollText, Search, SquareTerminal } from 'lucide-react'

/** Height, in percent of the editor column, the panel opens at the first time. */
export const BOTTOM_PANEL_DEFAULT_SIZE = 31

/** A tab of the workspace's bottom panel. */
export type BottomPanelTabId = 'console' | 'debug' | 'search' | 'plc-logs'

/** Label and icon of a bottom panel tab, in display order. */
export type BottomPanelTab = { id: BottomPanelTabId; label: string; Icon: LucideIcon }

const ALL_TABS: readonly BottomPanelTab[] = [
  { id: 'console', label: 'Console', Icon: SquareTerminal },
  { id: 'debug', label: 'Debugger', Icon: Bug },
  { id: 'search', label: 'Search', Icon: Search },
  { id: 'plc-logs', label: 'PLC Logs', Icon: ScrollText },
]

/** Which optional tabs are present; Console always is. */
export type BottomPanelTabVisibility = { debug: boolean; search: boolean; plcLogs: boolean }

/** The tabs shown for the given visibility, in display order. */
export const visibleBottomPanelTabs = (visibility: BottomPanelTabVisibility): BottomPanelTab[] =>
  ALL_TABS.filter(
    (tab) =>
      tab.id === 'console' ||
      (tab.id === 'debug' && visibility.debug) ||
      (tab.id === 'search' && visibility.search) ||
      (tab.id === 'plc-logs' && visibility.plcLogs),
  )

/** Narrows a Radix tab value to a bottom panel tab id. */
export const isBottomPanelTabId = (value: string): value is BottomPanelTabId => ALL_TABS.some((tab) => tab.id === value)
