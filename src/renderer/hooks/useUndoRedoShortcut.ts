import { useEffect } from 'react'

import { useOpenPLCStore } from '../store'

type UndoRedoCallback = {
  undo: () => void
  redo: () => void
}

export function useUndoRedoShortcut({ undo, redo }: UndoRedoCallback) {
  const isMonacoFocused = useOpenPLCStore((state) => state.isMonacoFocused)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isMonacoFocused) {
        return
      }

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0

      const ctrlOrCmd = isMac ? e.metaKey : e.ctrlKey

      if (ctrlOrCmd && e.key.toLowerCase() === 'z') {
        e.preventDefault()

        if (e.shiftKey) {
          redo()
        } else {
          undo()
        }
      }

      if (ctrlOrCmd && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [undo, redo, isMonacoFocused])
}
