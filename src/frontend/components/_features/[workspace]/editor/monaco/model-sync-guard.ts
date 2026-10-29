import type { MutableRefObject } from 'react'

/**
 * Run a write that reaches this editor's own Monaco model, without it counting
 * as a user edit.
 *
 * An ST POU's body editor and the STruC++ LSP model sync are bound to the same
 * `pou://` model, so writing the body to the store makes the sync call
 * `setValue` on it synchronously. `@monaco-editor/react` suppresses `onChange`
 * only for the edits it performs itself, so that write surfaces as an ordinary
 * content change and the editor would flag the POU unsaved. For a body that
 * came from disk that is wrong, and it is also self-perpetuating: the file
 * watcher only reloads a POU that is still saved.
 *
 * `fn` must be synchronous, which is what lets a single boolean stand in for a
 * counter: the whole window between raising and lowering the flag contains no
 * await, so no second write can interleave.
 *
 * The flag is lowered in a `finally` so a throw inside `fn` cannot leave it
 * raised, which would silently stop real edits from ever marking the file
 * unsaved again.
 */
export function runWithoutDirtying(flag: MutableRefObject<boolean>, fn: () => void): void {
  flag.current = true
  try {
    fn()
  } finally {
    flag.current = false
  }
}
