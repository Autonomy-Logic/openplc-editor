import { z } from 'zod'

export type UiPreferences = {
  radialMenuEnabled: boolean
}

export const UI_PREFERENCES_STORAGE_KEY = 'ui-preferences-v1'

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  radialMenuEnabled: true,
}

const uiPreferencesSchema = z
  .object({
    radialMenuEnabled: z.boolean(),
  })
  .partial()

type StorageReader = Pick<Storage, 'getItem'>
type StorageWriter = Pick<Storage, 'setItem'>

const defaultStorage = (): Storage | undefined => {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

/** Parses a stored JSON payload; unknown or invalid fields fall back to the defaults. */
export function parseUiPreferences(raw: string | null): UiPreferences {
  if (!raw) return { ...DEFAULT_UI_PREFERENCES }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return { ...DEFAULT_UI_PREFERENCES }
  }
  const parsed = uiPreferencesSchema.safeParse(json)
  if (!parsed.success) return { ...DEFAULT_UI_PREFERENCES }
  return { ...DEFAULT_UI_PREFERENCES, ...parsed.data }
}

export function loadUiPreferences(storage: StorageReader | undefined = defaultStorage()): UiPreferences {
  if (!storage) return { ...DEFAULT_UI_PREFERENCES }
  try {
    return parseUiPreferences(storage.getItem(UI_PREFERENCES_STORAGE_KEY))
  } catch {
    return { ...DEFAULT_UI_PREFERENCES }
  }
}

/** Best effort: a storage failure keeps the in-memory value only. */
export function persistUiPreferences(
  preferences: UiPreferences,
  storage: StorageWriter | undefined = defaultStorage(),
): void {
  if (!storage) return
  try {
    storage.setItem(UI_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // Quota or disabled storage.
  }
}
