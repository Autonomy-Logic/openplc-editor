import { createStore } from 'zustand/vanilla'

import { UI_PREFERENCES_STORAGE_KEY } from '../../utils/ui-preferences-storage'
import { createUiPreferencesSlice } from '../slices/ui-preferences/slice'
import type { UiPreferencesSlice } from '../slices/ui-preferences/types'

const makeStore = () => createStore<UiPreferencesSlice>()(createUiPreferencesSlice)

describe('createUiPreferencesSlice', () => {
  beforeEach(() => localStorage.clear())

  it('enables the radial menu by default', () => {
    expect(makeStore().getState().uiPreferences.radialMenuEnabled).toBe(true)
  })

  it('hydrates from the persisted preference', () => {
    localStorage.setItem(UI_PREFERENCES_STORAGE_KEY, JSON.stringify({ radialMenuEnabled: false }))
    expect(makeStore().getState().uiPreferences.radialMenuEnabled).toBe(false)
  })

  it('sets and persists the radial menu preference', () => {
    const store = makeStore()
    store.getState().uiPreferencesActions.setRadialMenuEnabled(false)
    expect(store.getState().uiPreferences.radialMenuEnabled).toBe(false)
    expect(JSON.parse(localStorage.getItem(UI_PREFERENCES_STORAGE_KEY) ?? '{}')).toEqual({ radialMenuEnabled: false })
  })

  it('toggles the radial menu and returns the new value', () => {
    const store = makeStore()
    expect(store.getState().uiPreferencesActions.toggleRadialMenu()).toBe(false)
    expect(store.getState().uiPreferences.radialMenuEnabled).toBe(false)
    expect(store.getState().uiPreferencesActions.toggleRadialMenu()).toBe(true)
    expect(store.getState().uiPreferences.radialMenuEnabled).toBe(true)
  })
})
