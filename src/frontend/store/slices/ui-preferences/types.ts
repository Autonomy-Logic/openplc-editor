import type { UiPreferences } from '../../../utils/ui-preferences-storage'

export type UiPreferencesState = {
  uiPreferences: UiPreferences
}

export type UiPreferencesActions = {
  /** Enables or disables the radial menu of the graphical editors and persists the choice. */
  setRadialMenuEnabled: (enabled: boolean) => void
  /** Flips the radial menu preference and returns the new value. */
  toggleRadialMenu: () => boolean
}

export type UiPreferencesSlice = UiPreferencesState & {
  uiPreferencesActions: UiPreferencesActions
}
