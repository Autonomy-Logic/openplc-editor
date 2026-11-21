import { useEffect, useRef } from 'react'

/** True for Ctrl+J or Cmd+J with no other modifier. */
export const isBottomPanelShortcut = (
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
) => (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'j'

/** Calls `onToggle` on Ctrl+J (Cmd+J on macOS), caught before any focused editor sees the key. */
export const useBottomPanelShortcut = (onToggle: () => void) => {
  const onToggleRef = useRef(onToggle)
  onToggleRef.current = onToggle

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isBottomPanelShortcut(event)) return
      event.preventDefault()
      event.stopPropagation()
      if (!event.repeat) onToggleRef.current()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [])
}
