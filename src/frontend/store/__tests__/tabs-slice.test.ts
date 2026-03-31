import { createStore } from 'zustand/vanilla'

import { createTabsSlice } from '../slices/tabs/slice'
import type { TabsProps, TabsSlice } from '../slices/tabs/types'

function makeStore() {
  return createStore<TabsSlice>()(createTabsSlice)
}

function makeTab(name: string, type: TabsProps['elementType']['type'] = 'program'): TabsProps {
  switch (type) {
    case 'program':
      return { name, elementType: { type: 'program', language: 'st' } }
    case 'function':
      return { name, elementType: { type: 'function', language: 'il' } }
    case 'resource':
      return { name, elementType: { type: 'resource' } }
    default:
      return { name, elementType: { type: 'program', language: 'st' } }
  }
}

describe('createTabsSlice', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => {
    store = makeStore()
  })

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------
  it('should have correct initial state', () => {
    const state = store.getState()
    expect(state.tabs).toEqual([])
    expect(state.selectedTab).toBeNull()
  })

  // -------------------------------------------------------------------------
  // setTabs
  // -------------------------------------------------------------------------
  it('setTabs replaces all tabs', () => {
    const tabs = [makeTab('Tab1'), makeTab('Tab2')]
    store.getState().tabsActions.setTabs(tabs)
    expect(store.getState().tabs).toEqual(tabs)
  })

  // -------------------------------------------------------------------------
  // updateTabs
  // -------------------------------------------------------------------------
  it('updateTabs adds a new tab', () => {
    const tab = makeTab('New')
    store.getState().tabsActions.updateTabs(tab)
    expect(store.getState().tabs).toHaveLength(1)
    expect(store.getState().tabs[0].name).toBe('New')
  })

  it('updateTabs does not add duplicate tab', () => {
    const tab = makeTab('New')
    store.getState().tabsActions.updateTabs(tab)
    store.getState().tabsActions.updateTabs(tab)
    expect(store.getState().tabs).toHaveLength(1)
  })

  // -------------------------------------------------------------------------
  // sortTabs
  // -------------------------------------------------------------------------
  it('sortTabs replaces tabs with sorted array', () => {
    const tabs = [makeTab('B'), makeTab('A')]
    store.getState().tabsActions.setTabs([makeTab('A'), makeTab('B')])
    store.getState().tabsActions.sortTabs(tabs)
    expect(store.getState().tabs[0].name).toBe('B')
    expect(store.getState().tabs[1].name).toBe('A')
  })

  // -------------------------------------------------------------------------
  // removeTab
  // -------------------------------------------------------------------------
  it('removeTab removes a tab by name', () => {
    store.getState().tabsActions.setTabs([makeTab('A'), makeTab('B')])
    store.getState().tabsActions.removeTab('A')
    expect(store.getState().tabs).toHaveLength(1)
    expect(store.getState().tabs[0].name).toBe('B')
  })

  // -------------------------------------------------------------------------
  // updateTabName
  // -------------------------------------------------------------------------
  it('updateTabName renames an existing tab', () => {
    store.getState().tabsActions.setTabs([makeTab('Old')])
    store.getState().tabsActions.setSelectedTab('Old')
    store.getState().tabsActions.updateTabName('Old', 'New')

    expect(store.getState().tabs[0].name).toBe('New')
    expect(store.getState().selectedTab).toBe('New')
  })

  it('updateTabName does not update selectedTab when it does not match oldName', () => {
    store.getState().tabsActions.setTabs([makeTab('A'), makeTab('B')])
    store.getState().tabsActions.setSelectedTab('B')
    store.getState().tabsActions.updateTabName('A', 'Renamed')

    expect(store.getState().tabs[0].name).toBe('Renamed')
    expect(store.getState().selectedTab).toBe('B')
  })

  it('updateTabName does nothing when tab not found', () => {
    store.getState().tabsActions.setTabs([makeTab('A')])
    store.getState().tabsActions.updateTabName('NonExistent', 'New')
    expect(store.getState().tabs[0].name).toBe('A')
  })

  // -------------------------------------------------------------------------
  // clearTabs
  // -------------------------------------------------------------------------
  it('clearTabs resets tabs and selectedTab', () => {
    store.getState().tabsActions.setTabs([makeTab('A')])
    store.getState().tabsActions.setSelectedTab('A')
    store.getState().tabsActions.clearTabs()

    expect(store.getState().tabs).toEqual([])
    expect(store.getState().selectedTab).toBeNull()
  })

  // -------------------------------------------------------------------------
  // setSelectedTab
  // -------------------------------------------------------------------------
  it('setSelectedTab sets the selected tab', () => {
    store.getState().tabsActions.setSelectedTab('MyTab')
    expect(store.getState().selectedTab).toBe('MyTab')
  })

  // -------------------------------------------------------------------------
  // getSelectedTab
  // -------------------------------------------------------------------------
  it('getSelectedTab returns selected tab name', () => {
    store.getState().tabsActions.setSelectedTab('TabX')
    expect(store.getState().tabsActions.getSelectedTab()).toBe('TabX')
  })

  it('getSelectedTab returns null when no tab selected', () => {
    expect(store.getState().tabsActions.getSelectedTab()).toBeNull()
  })
})
