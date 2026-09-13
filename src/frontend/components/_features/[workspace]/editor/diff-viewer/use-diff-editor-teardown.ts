// Tears a Monaco diff editor down widget-first, then models — `@monaco-editor/react` (4.7) does the
// reverse and Monaco throws an uncaught error. Pair with `keepCurrentOriginalModel` /
// `keepCurrentModifiedModel` on the editor and with `useDiffModelPaths()` below.

import type { editor as MonacoEditor } from 'monaco-editor'
import { useEffect, useId, useRef } from 'react'

export function useDiffEditorTeardown() {
  const editorRef = useRef<MonacoEditor.IStandaloneDiffEditor | null>(null)

  useEffect(
    () => () => {
      const editor = editorRef.current

      if (!editor) {
        return
      }

      editorRef.current = null

      // Read the models before touching the widget: after `setModel(null)` there is nothing left to ask.
      const models = editor.getModel()

      try {
        editor.setModel(null)
      } catch {
        // Already disposed by the library's own cleanup; the models below still need disposing.
      }

      models?.original.dispose()
      models?.modified.dispose()
    },
    [],
  )

  return editorRef
}

// A model URI pair unique to one mounted editor (else every diff editor shares one model pair)
// and stable for its lifetime (a changing path resurrects a stale model). `useId`'s punctuation
// is stripped since a colon inside `inmemory://…`'s authority reads as a port.
export function useDiffModelPaths(): { original: string; modified: string } {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '')

  return { original: `inmemory://diff${id}/original`, modified: `inmemory://diff${id}/modified` }
}
