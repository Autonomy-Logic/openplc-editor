/**
 * useNavigateToCompileError — open the right POU tab and place the
 * editor cursor where strucpp said the error is.
 *
 * Routing rules (driven entirely by structured fields on the
 * `CompileError`, no string parsing):
 *
 *   • language ∈ ld/fbd/sfc  →  open the POU tab and stop there.  The
 *     synthesized ST that strucpp saw is never shown to the user, so
 *     a line number wouldn't make sense; opening the graphical view
 *     gets them to the right place.
 *
 *   • section === 'body' (textual languages)  →  open the POU tab,
 *     activate the body view, and place the Monaco cursor at
 *     `bodyLine` (which the strucpp annotation pass already remapped
 *     from the per-POU file's body offset to the user-facing body
 *     line).
 *
 *   • section === 'var-block'  →  open the POU tab, switch the
 *     variables panel into code (text) mode, and place the cursor at
 *     `error.line` — which is the line in the per-POU `.st` file the
 *     editor's vars-text Monaco view roughly aligns with.  The slight
 *     offset that can creep in for multi-block variable lists is
 *     accepted as-is per the prior decision; we'll revisit when
 *     xml2st is retired.
 *
 *   • anything else (interface, no POU context, unknown POU)  →  open
 *     the POU tab if we can identify it, otherwise no-op.  Better
 *     than a silent failure-to-react.
 *
 * The hook deliberately tolerates partial information: a missing POU
 * (e.g. compile error for a POU that's been deleted since) or a
 * stale line number (POU edited after compile failure) just produces
 * the best-effort navigation instead of throwing.
 */

import type { StructuredCompileError } from '@root/middleware/shared/ports/types'
import { useCallback } from 'react'

import { useOpenPLCStore } from '../store'
import type { TabsProps } from '../store/slices/tabs'
import { CreateEditorObjectFromTab } from '../store/slices/tabs/utils'

/** Languages whose graphical view the user actually edits — opening
 *  these means activating the diagram, not jumping to a synthetic ST
 *  line.  Native languages (python/cpp) are textual, so they take the
 *  body-line path. */
const GRAPHICAL_LANGUAGES = new Set(['ld', 'fbd', 'sfc'])

export function useNavigateToCompileError(): (err: StructuredCompileError) => void {
  const pous = useOpenPLCStore((s) => s.project.data.pous)
  const updateTabs = useOpenPLCStore((s) => s.tabsActions.updateTabs)
  const setSelectedTab = useOpenPLCStore((s) => s.tabsActions.setSelectedTab)
  const addModel = useOpenPLCStore((s) => s.editorActions.addModel)
  const setEditor = useOpenPLCStore((s) => s.editorActions.setEditor)
  const getEditorFromEditors = useOpenPLCStore((s) => s.editorActions.getEditorFromEditors)
  const setEditorCursor = useOpenPLCStore((s) => s.editorActions.setEditorCursor)
  const updateModelVariablesForName = useOpenPLCStore((s) => s.editorActions.updateModelVariablesForName)

  return useCallback(
    (err: StructuredCompileError): void => {
      if (!err.pouName) return

      // Strucpp uppercases names; the project model preserves the
      // user's casing.  Match case-insensitively so navigation lands
      // regardless of which side normalised the name.
      const target = err.pouName.toUpperCase()
      const pou = pous.find((p) => p.name.toUpperCase() === target)
      if (!pou) return // POU was likely deleted between compile and click

      const language = pou.body.language as TabsProps['elementType'] extends { language: infer L } ? L : never
      const pouType = pou.pouType
      // PLCResource / data-types / etc. don't surface as a POU here —
      // pous filter is already POU-only — so the tab elementType is
      // always one of program/function/function-block.
      const tab: TabsProps = {
        name: pou.name,
        path: pou.name,
        elementType: { type: pouType, language: language as 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'python' | 'cpp' },
      }

      // Open / activate the tab using the same pattern explorer.tsx
      // uses when the user clicks a POU.  Idempotent: re-opening an
      // already-open tab just re-selects it.
      updateTabs(tab)
      let model = getEditorFromEditors(pou.name)
      if (!model) {
        model = CreateEditorObjectFromTab(tab)
        addModel(model)
      }
      setEditor(model)
      setSelectedTab(pou.name)

      // Graphical languages: opening the tab is the whole story.  The
      // user will land on the diagram view — synthesized ST line
      // numbers don't map to anything they can act on.
      if (GRAPHICAL_LANGUAGES.has(language as string)) return

      // Textual body errors: place the cursor at bodyLine if we have
      // it, otherwise fall back to error.line as a best effort.
      // setEditorCursor writes to BOTH the editors-array entry and
      // the active editor draft so the Monaco reactive useEffect
      // (which watches `editor.cursorPosition`) actually fires.
      if (err.section === 'body') {
        const lineNumber = err.bodyLine ?? err.line
        if (lineNumber > 0) {
          setEditorCursor(pou.name, {
            lineNumber,
            column: Math.max(1, err.column),
            offset: 0,
            target: 'body',
          })
        }
        return
      }

      // Var-block errors: switch the variables panel to text mode and
      // route the cursor through it.  The `target: 'variables'` tag
      // keeps the body Monaco from also re-highlighting the same line
      // number in the body (which would be meaningless for a var-block
      // error and visually distracting).
      if (err.section === 'var-block') {
        updateModelVariablesForName(pou.name, { display: 'code' })
        if (err.line > 0) {
          setEditorCursor(pou.name, {
            lineNumber: err.line,
            column: Math.max(1, err.column),
            offset: 0,
            target: 'variables',
          })
        }
        return
      }

      // section === 'interface' or unset — opening the tab is enough.
    },
    [
      pous,
      updateTabs,
      setSelectedTab,
      addModel,
      setEditor,
      getEditorFromEditors,
      setEditorCursor,
      updateModelVariablesForName,
    ],
  )
}
