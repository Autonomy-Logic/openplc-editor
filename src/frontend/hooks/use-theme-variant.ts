import { useCallback, useSyncExternalStore } from 'react'

import type { ThemeVariant } from '../../middleware/shared/ports/theme-port'
import { useTheme } from '../../middleware/shared/providers'

/**
 * Reactively returns the current theme variant.
 *
 * Wraps the ThemePort so components can read the active theme without
 * wiring up their own subscription to `onThemeChanged`.
 */
export function useThemeVariant(): ThemeVariant {
  const themePort = useTheme()
  const subscribe = useCallback((onStoreChange: () => void) => themePort.onThemeChanged(onStoreChange), [themePort])
  const getSnapshot = useCallback(() => themePort.getCurrentTheme(), [themePort])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
