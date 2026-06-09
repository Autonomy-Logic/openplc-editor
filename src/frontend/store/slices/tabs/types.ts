// ---------------------------------------------------------------------------
// Tab element types — superset of both editor and web
// ---------------------------------------------------------------------------

export type TabsProps = {
  name: string
  path?: string
  elementType:
    | { type: 'program'; language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'python' | 'cpp' }
    | { type: 'function'; language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'python' | 'cpp' }
    | { type: 'function-block'; language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'python' | 'cpp' }
    | { type: 'data-type'; derivation: 'enumerated' | 'structure' | 'array' }
    | { type: 'resource' }
    | { type: 'device'; derivation: 'configuration' | 'pin-mapping' | 'orchestrators' }
    | { type: 'server'; protocol: 'modbus-tcp' | 's7comm' | 'ethernet-ip' | 'opcua' }
    | { type: 'remote-device'; protocol: 'modbus-tcp' | 'ethernet-ip' | 'ethercat' | 'profinet' }
    | { type: 'vendor-screen'; screenName: string }
    | { type: 'package-manager' }
    | { type: 'library-manager' }
    | { type: 'library-manifest' }
    | { type: 'ethercat-device'; busName: string; deviceId: string }
    | { type: 'diff-viewer'; filePath: string }
  configuration?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Tabs state & actions
// ---------------------------------------------------------------------------

export type TabsState = {
  tabs: TabsProps[]
  selectedTab: string | null
}

export type TabsActions = {
  setTabs: (tabs: TabsProps[]) => void
  updateTabs: (tab: TabsProps) => void
  sortTabs: (tabs: TabsProps[]) => void
  removeTab: (tabToRemove: string) => void
  updateTabName: (oldName: string, newName: string) => void
  clearTabs: () => void
  setSelectedTab: (tabName: string) => void
  getSelectedTab: () => string | null
}

export type TabsSlice = TabsState & {
  tabsActions: TabsActions
}
