import type { ReactNode } from 'react'

import styles from './theme-root.module.css'

export type Theme = 'light' | 'dark' | 'system'

export interface ThemeRootProps {
  readonly theme: Theme
  readonly children: ReactNode
}

/**
 * Scopes the design tokens to a subtree instead of the global `:root`, so the example's styles cannot
 * leak into, or be overridden by, another app on the same page.
 */
export function ThemeRoot({ theme, children }: ThemeRootProps) {
  return (
    <div className={styles.root} data-theme={theme}>
      {children}
    </div>
  )
}
