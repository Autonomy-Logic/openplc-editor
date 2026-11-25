import { useOpenPLCStore } from '@root/frontend/store'
import type { TabsProps } from '@root/frontend/store/slices/tabs/types'
import { useHmiPreview } from '@root/middleware/shared/providers'
import { useEffect } from 'react'

/** Whether a tab edits the project's HMI: a screen, a widget block or the HMI settings. */
export const isHmiTab = (tab: TabsProps): boolean =>
  tab.elementType.type === 'hmi-screen' ||
  tab.elementType.type === 'hmi-widget' ||
  tab.elementType.type === 'hmi-settings'

/**
 * Holds the WebAssembly toolchain while any HMI tab is open, so preview rebuilds reuse loaded compiler workers; the
 * hold ends when the last HMI tab closes or the workspace unmounts.
 */
export function useHoldHmiToolchain(): void {
  const hmiOpen = useOpenPLCStore((s) => s.tabs.some(isHmiTab))
  const hmiPreview = useHmiPreview()
  useEffect(() => {
    if (!hmiPreview || !hmiOpen) return
    hmiPreview.holdToolchain(true).catch(() => undefined)
    return () => {
      hmiPreview.holdToolchain(false).catch(() => undefined)
    }
  }, [hmiPreview, hmiOpen])
}
