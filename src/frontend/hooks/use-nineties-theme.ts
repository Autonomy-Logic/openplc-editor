import { useSyncExternalStore } from 'react'

/**
 * Reactively reports whether the retro "90's" theme is active.
 *
 * The theme is represented by the `nineties` class on <html> (set by the
 * Display menu / app-layout / theme adapter). We observe that class directly
 * rather than going through the Zustand store, because the menu toggles the
 * class imperatively — this keeps the signal correct no matter which path
 * changed the theme, with zero coupling to the store shape.
 */
function subscribe(callback: () => void): () => void {
  const observer = new MutationObserver(callback)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

function getSnapshot(): boolean {
  return document.documentElement.classList.contains('nineties')
}

export function useIsNinetiesTheme(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
