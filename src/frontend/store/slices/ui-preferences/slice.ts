import { produce } from 'immer'
import { StateCreator } from 'zustand'

import { loadUiPreferences, persistUiPreferences } from '../../../utils/ui-preferences-storage'
import type { UiPreferencesSlice } from './types'

const createUiPreferencesSlice: StateCreator<UiPreferencesSlice, [], [], UiPreferencesSlice> = (
  setState,
  getState,
) => ({
  uiPreferences: loadUiPreferences(),

  uiPreferencesActions: {
    setRadialMenuEnabled: (enabled) => {
      setState(
        produce((draft: UiPreferencesSlice) => {
          draft.uiPreferences.radialMenuEnabled = enabled
        }),
      )
      persistUiPreferences(getState().uiPreferences)
    },

    toggleRadialMenu: () => {
      const enabled = !getState().uiPreferences.radialMenuEnabled
      getState().uiPreferencesActions.setRadialMenuEnabled(enabled)
      return enabled
    },
  },
})

export { createUiPreferencesSlice }
