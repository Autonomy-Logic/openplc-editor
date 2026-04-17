import type * as monaco from 'monaco-editor'

import { darkThemeData, lightThemeData } from './configs/themes/openplc/openplc'

const instancesWithOpenplcThemes = new WeakSet<object>()

/**
 * Ensures that the custom OpenPLC themes are defined on the given Monaco instance.
 * This function is idempotent - it will only define themes once per instance.
 *
 * @param monacoInstance - The Monaco instance to define themes on
 */
export function ensureOpenplcThemes(monacoInstance: typeof monaco) {
  try {
    if (instancesWithOpenplcThemes.has(monacoInstance)) {
      return
    }
    monacoInstance.editor.defineTheme('openplc-light', lightThemeData)
    monacoInstance.editor.defineTheme('openplc-dark', darkThemeData)
    instancesWithOpenplcThemes.add(monacoInstance)
  } catch (e) {
    console.error('[Monaco] Failed to define themes', e)
    const isDark = document.documentElement.classList.contains('dark')
    monacoInstance.editor.setTheme(isDark ? 'vs-dark' : 'vs')
  }
}

/**
 * Applies the correct theme to the Monaco instance based on the current app theme.
 *
 * @param monacoInstance - The Monaco instance to apply the theme to
 * @param isDark - Whether dark mode is active (from the Zustand store)
 */
export function applyThemeNow(monacoInstance: typeof monaco, isDark: boolean) {
  const themeName = isDark ? 'openplc-dark' : 'openplc-light'
  monacoInstance.editor.setTheme(themeName)
}
