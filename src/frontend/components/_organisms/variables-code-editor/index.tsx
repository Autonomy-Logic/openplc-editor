import Editor, { OnMount } from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'
import * as monaco from 'monaco-editor'
import { useEffect, useRef, useState } from 'react'

import { pouVarsUri } from '../../../services/st-lsp/types'

interface VariablesCodeEditorProps {
  code: string
  onCodeChange: (code: string) => void
  shouldUseDarkMode: boolean
  /**
   * Monaco language ID for tokenisation.  Default `'st'` matches
   * the historical IEC VAR-block use case shared by ST/IL/graphical
   * POUs.  Python POUs pass `'python'` so the synthesised
   * module-globals preamble highlights as Python and matches the
   * body editor visually.
   */
  language?: string
  /**
   * When true, Monaco renders the buffer non-editable.  Used for
   * Python POUs whose code-mode shows the same module-globals
   * preamble Pyright analyses — `parseIecStringToVariables` can't
   * round-trip Python syntax, so accepting edits would silently
   * drop them on commit.  Variable editing for Python POUs
   * happens in table mode only.
   */
  readOnly?: boolean
  /**
   * POU name whose VAR blocks this editor surface displays.  When
   * provided, the Monaco model URI is derived from it
   * (`inmemory://pouvars/<name>.st`) so the LSP providers can
   * recognise the variables-text view and route Go to Definition /
   * Hover queries to the corresponding `pou://` document with the
   * right line-offset translation.
   *
   * Optional because this editor is also re-used for non-POU
   * surfaces (global variables, FB instances, tasks) where no
   * corresponding LSP document exists — leave unset there and
   * `@monaco-editor/react` mints an internal URI with no
   * cross-routing.
   */
  pouName?: string
  /**
   * Programmatic cursor jump (e.g. compile-error click → vars-text
   * view, or Go to Definition redirect for a variable declaration).
   * Applied on mount and whenever the value changes; the caller is
   * responsible for clearing it once the user takes over, but a
   * stale value is harmless because we only re-apply when it
   * actually differs from the editor's current position.
   *
   * `target` filters which Monaco surface consumes the jump.  When
   * `target === 'body'`, the variables editor ignores the position
   * (it's meant for the body editor).  Undefined or
   * `target === 'variables'` is honoured here.
   */
  cursorPosition?: { lineNumber: number; column: number; target?: 'body' | 'variables' }
}

const VariablesCodeEditor = ({
  code,
  onCodeChange,
  shouldUseDarkMode,
  cursorPosition,
  pouName,
  language = 'st',
  readOnly = false,
}: VariablesCodeEditorProps) => {
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [editorMounted, setEditorMounted] = useState(false)

  const handleEditorDidMount: OnMount = (editor) => {
    editorRef.current = editor
    editor.layout()
    setEditorMounted(true)
  }

  useEffect(() => {
    if (!containerRef.current) return

    const observer = new ResizeObserver(() => {
      if (editorRef.current) {
        editorRef.current.layout()
      }
    })

    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
    }
  }, [])

  // Apply programmatic cursor jumps from the navigation hook.  Selects
  // the whole target line for visible feedback — same UX shape as
  // Search and the body Monaco editor.  Equality guard prevents
  // redundant reveal animations when the caller passes the same nav
  // twice.
  useEffect(() => {
    if (!editorMounted || !cursorPosition) return
    // Jumps explicitly tagged for the body editor never apply here.
    if (cursorPosition.target === 'body') return
    const ed = editorRef.current
    if (!ed) return
    const current = ed.getPosition()
    if (current && current.lineNumber === cursorPosition.lineNumber && current.column === cursorPosition.column) {
      return
    }
    const model = ed.getModel()
    // Clamp to the model's valid line range so an out-of-bounds cursor
    // (e.g. a compile-error click whose remapped line points past the
    // generated vars-text content) lands on the closest valid line
    // instead of crashing the editor with `BugIndicatingError: Illegal
    // value for lineNumber` from `getLineMaxColumn` / `Range`.
    const safeLine = model
      ? Math.max(1, Math.min(model.getLineCount(), cursorPosition.lineNumber))
      : cursorPosition.lineNumber
    if (model && safeLine !== cursorPosition.lineNumber) {
      console.warn(
        `[variables-code-editor] cursor target line ${cursorPosition.lineNumber} out of range (model has ${model.getLineCount()} lines); clamped to ${safeLine}`,
      )
    }
    const lineLength = model ? model.getLineMaxColumn(safeLine) : cursorPosition.column
    const range = new monaco.Range(safeLine, 1, safeLine, lineLength)
    ed.setSelection(range)
    ed.revealRangeInCenter(range)
    ed.focus()
  }, [cursorPosition, editorMounted])

  return (
    // `nokey` opts keystrokes inside this Monaco instance out of
    // @xyflow/react's global Space pan-modifier listener.  See the
    // long comment on the body Monaco wrapper (`oplc-monaco-wrapper`
    // in `editor/monaco/index.tsx`) for the full diagnosis.  Without
    // this opt-out, switching the variables table to text mode
    // silently drops every typed Space (xyflow `preventDefault`s the
    // keystroke before Monaco's new EditContext can commit it).
    <div
      ref={containerRef}
      aria-label='Variable Code Editor Container'
      className='nokey h-full w-full'
      style={{ overflow: 'hidden' }}
    >
      <Editor
        height='100%'
        width='100%'
        language={language}
        {...(pouName ? { path: pouVarsUri(pouName) } : {})}
        defaultValue={''}
        value={code}
        onMount={handleEditorDidMount}
        onChange={(value) => onCodeChange(value ?? '')}
        options={{
          readOnly,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          // Pinned for cross-platform consistency with the body editor.
          // Matches Monaco's macOS default; explicit so Linux/Windows
          // don't fall back to 14 and mismatch the body surface.
          fontSize: 12,
          // Re-parent hover / suggest / signature-help / parameter-hint
          // widgets to `document.body` with `position: fixed`.  The
          // variables-code-editor is a short panel — without this flag,
          // Monaco's hover bubble flips upward but still gets clipped
          // by the editor's own bounding box at the top.  Same
          // motivation as the body editor's identical setting.
          fixedOverflowWidgets: true,
          // Monaco's standalone themes default `semanticHighlighting`
          // to `false`; without this, the editor receives tokens from
          // the LSP semantic-tokens provider but silently drops them
          // before rendering — the user sees Monarch colours only.
          // The body editor sets the same flag in monaco/index.tsx.
          // Whichever 'st' editor mounts first with this flag enables
          // semantic-token processing globally for the language,
          // which is why opening an ST POU body would light up an
          // already-mounted variables-text editor by side effect.
          'semanticHighlighting.enabled': true,
          // Match the body editor's default (Monaco's default is 4 too).
          // Inconsistent values would split-personality the indentation
          // of LSP-inserted snippets (`\t` substitutes per this option).
          tabSize: 4,
          inlineSuggest: { enabled: false },
          quickSuggestions: false,
        }}
        theme={shouldUseDarkMode ? 'openplc-dark' : 'openplc-light'}
      />
    </div>
  )
}

export { VariablesCodeEditor }
