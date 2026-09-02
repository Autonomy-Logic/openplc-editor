/**
 * Tearing a Monaco diff editor down in the order Monaco requires.
 *
 * `@monaco-editor/react` (4.7) does it the other way round: its cleanup disposes the two
 * text models and only then the widget still holding them. Monaco answers with an UNCAUGHT
 * error — "TextModel got disposed before DiffEditorWidget model got reset" — the instant a
 * diff unmounts.
 *
 * WHY THIS LIVES IN ITS OWN MODULE. It began inline in `FileDiffView`, which was enough
 * until the branch merge screen arrived: that screen mounts `DiffEditor` directly, twice,
 * and so brought the crash straight back through a path the first fix never covered. One
 * copy per Monaco call site is how that happens again, so there is one copy here and every
 * call site uses it.
 *
 * Pair it with `keepCurrentOriginalModel` / `keepCurrentModifiedModel` on the editor —
 * those stop the library disposing anything — and with `diffModelPaths()` so instances do
 * not share models.
 */

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

      // Read the models before touching the widget: after `setModel(null)` there is nothing
      // left to ask, and these are the objects that have to be disposed.
      const models = editor.getModel()

      try {
        editor.setModel(null)
      } catch {
        // Already disposed by the library's own cleanup. Nothing to release, and the models
        // below still need disposing. Order-independent on purpose: whether React reaches
        // this cleanup before the library's is its own business.
      }

      models?.original.dispose()
      models?.modified.dispose()
    },
    [],
  )

  return editorRef
}

/**
 * A model URI pair unique to one mounted editor, and stable for its lifetime.
 *
 * Unique because the library derives the URI from these props and defaults them to the
 * empty string, so every diff editor in the app would otherwise share one pair of models —
 * reachable now that a merge screen can sit over a workspace whose own diff is mounted.
 *
 * Stable because the library only creates a model when it cannot find one at the URI, and
 * hands back the existing one otherwise, with its old content. A changing path would
 * resurrect a stale model; a fixed path lets the library's own value sync update the text.
 *
 * `useId` is punctuated (`:r0:`) and a colon inside the authority of `inmemory://…` reads
 * as a port, so it is stripped to letters and digits.
 */
export function useDiffModelPaths(): { original: string; modified: string } {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '')

  return { original: `inmemory://diff${id}/original`, modified: `inmemory://diff${id}/modified` }
}
