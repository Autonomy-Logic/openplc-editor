import { Editor as PrimitiveEditor } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useIsDebuggerVisible } from '../../../../hooks/use-debug-value'
import { useStDebugDecorations } from '../../../../hooks/use-st-debug-decorations'
import { getExecuteDraftApi } from '../../../../services/st-lsp/execute-sync'
import { useOpenPLCStore } from '../../../../store'
import { cn } from '../../../../utils/cn'
import { applyThemeNow, ensureOpenplcThemes } from '../../../_features/[workspace]/editor/monaco/theme-utils'

/**
 * Structured Text editing surface for the Execute ("ST Block") element in LD
 * and FBD, and for its expand modal.
 *
 * Separate from the POU-level `MonacoEditor`, which is bound to a POU (store
 * lookups, project sync, file watchers, AI hooks). A rung can hold several
 * Execute boxes, so Monaco mounts lazily — the field renders plain text until
 * activated. The model is created under `uri`, the same URI the ST LSP holds
 * the snippet's document on, which is what makes diagnostics attach.
 */

const PLACEHOLDER = 'Enter ST code here'

export type StCodeFieldProps = {
  /** Current snippet. Treated as the source of truth while unfocused. */
  value: string
  /** Called on blur (and on unmount while dirty) with the edited text. */
  onCommit: (next: string) => void
  /**
   * LSP document URI for this snippet — also the Monaco model URI, which
   * is what makes diagnostics attach. Must be unique per node.
   */
  uri: string
  /**
   * Composite-key prefix for debug value badges, e.g. `MyProgram:`.
   * Omit to disable badges (the modal in a non-debug session).
   */
  debugPrefix?: string
  /**
   * When false the field stays in its cheap read-only presentation and
   * never mounts Monaco. The node passes `selected`; the modal passes
   * `true`.
   */
  active?: boolean
  /**
   * `compact` — the in-rung box: no line numbers or gutter, small type, every
   * pixel spent on code because the element is only ~200px wide.
   * `full` — the expand modal: a proper editor, matching the POU-level ST
   * editor's font size, gutter and padding. That is the whole point of
   * expanding.
   */
  variant?: 'compact' | 'full'
  className?: string
  /**
   * Fires as the user types, with the snippet's current line count. The
   * owning node uses it to grow/shrink itself live — without it the box
   * keeps its committed height while the text runs past the bottom edge.
   */
  onLineCountChange?: (lineCount: number) => void
}

export const StCodeField = ({
  value,
  onCommit,
  uri,
  debugPrefix,
  active = false,
  variant = 'compact',
  className,
  onLineCountChange,
}: StCodeFieldProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof monaco | null>(null)
  const shouldUseDarkMode = useOpenPLCStore((state) => state.workspace.systemConfigs.shouldUseDarkMode)
  const isDebuggerVisible = useIsDebuggerVisible()

  // The debugger makes every code surface read-only — the running program is
  // what it is; editing it here would be a lie.
  const effectiveReadOnly = isDebuggerVisible

  // Monaco mounting is invisible to React — `onMount` only fills refs, so
  // nothing re-renders. Without this flag the decoration scan below runs once
  // against a null editor and never again. `MonacoEditor` guards the same trap.
  const [editorMounted, setEditorMounted] = useState(false)

  // Local buffer so typing doesn't round-trip through the store on
  // every keystroke. Re-synced from `value` whenever the field is not
  // the thing driving the change.
  const [draft, setDraft] = useState(value)
  const draftRef = useRef(value)
  const dirtyRef = useRef(false)
  const lspTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Push the draft to the LSP as the user types. The store only sees the
  // snippet on blur, so a store-driven sync would deliver diagnostics a commit
  // late — by which point the field may be deselected and its model disposed,
  // leaving markers nowhere to land. Debounced into one `didChange`.
  const scheduleLspSync = useCallback(
    (text: string) => {
      if (lspTimerRef.current !== null) clearTimeout(lspTimerRef.current)
      lspTimerRef.current = setTimeout(() => {
        lspTimerRef.current = null
        getExecuteDraftApi()?.syncDraft(uri, text)
      }, 200)
    },
    [uri],
  )

  useEffect(
    () => () => {
      if (lspTimerRef.current !== null) clearTimeout(lspTimerRef.current)
    },
    [],
  )

  // Publish on mount so an already-broken snippet is underlined before a key
  // is pressed. `force` is required: diagnostics are a one-shot notification,
  // and mounting creates a NEW model (the expand modal builds a second one at
  // the same URI) with usually-unchanged text, so without a forced re-analyse
  // the worker stays silent. Keyed on `editorMounted` — the model does not
  // exist until Monaco has mounted.
  useEffect(() => {
    if (!active || !editorMounted) return
    getExecuteDraftApi()?.syncDraft(uri, draftRef.current, true)
  }, [active, editorMounted, uri])

  useEffect(() => {
    if (dirtyRef.current) return
    setDraft(value)
    draftRef.current = value
  }, [value])

  const commit = useCallback(() => {
    if (!dirtyRef.current) return
    dirtyRef.current = false
    if (draftRef.current === value) return
    onCommit(draftRef.current)
  }, [onCommit, value])

  // Latest `commit` for callbacks registered once at mount, so the blur
  // handler below never runs against a stale `value`.
  const commitRef = useRef(commit)
  commitRef.current = commit

  // Commit anything still buffered when the field goes away — a node
  // deleted or a modal closed mid-edit must not silently lose the text.
  // `commit` changes identity with `value`, so this cleanup also runs on an
  // ordinary re-render; that is harmless because `commit` no-ops unless the
  // buffer is dirty.
  useEffect(() => commit, [commit])

  useStDebugDecorations({
    editorRef,
    monacoRef,
    prefix: debugPrefix,
    enabled: active && editorMounted && isDebuggerVisible && debugPrefix !== undefined,
    modelVersion: draft,
  })

  const handleMount = useCallback(
    (editor: monaco.editor.IStandaloneCodeEditor, monacoInstance: typeof monaco) => {
      editorRef.current = editor
      monacoRef.current = monacoInstance
      setEditorMounted(true)
      ensureOpenplcThemes(monacoInstance)
      applyThemeNow(monacoInstance, shouldUseDarkMode)
      editor.onDidBlurEditorText(() => commitRef.current())
    },
    [shouldUseDarkMode],
  )

  useEffect(() => {
    if (monacoRef.current) applyThemeNow(monacoRef.current, shouldUseDarkMode)
  }, [shouldUseDarkMode])

  // Blur (and commit) on a click anywhere outside the field. The rung's React
  // Flow pane covers only the rung, so a click elsewhere on the page never
  // reaches it and the editor would otherwise keep focus indefinitely.
  useEffect(() => {
    if (!active) return
    const onPointerDown = (event: PointerEvent) => {
      const container = containerRef.current
      if (!container) return
      const target = event.target
      if (target instanceof Node && container.contains(target)) return
      // Monaco's overlays (suggest widget, hovers) portal outside the
      // container; blurring while one is open would fight the user.
      if (target instanceof Element && target.closest('.monaco-editor')) return
      editorRef.current?.getDomNode()?.blur()
      commit()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [active, commit])

  // Going inactive unmounts Monaco, leaving the refs on a disposed editor.
  // Cleared in an effect rather than during render.
  useEffect(() => {
    if (active) return
    editorRef.current = null
    monacoRef.current = null
    setEditorMounted(false)
  }, [active])

  if (!active) {
    // Cheap presentation: no Monaco, no LSP document, no decorations.
    return (
      <pre
        aria-label='Structured Text'
        className={cn(
          'm-0 h-full w-full overflow-hidden whitespace-pre px-2 py-1 font-mono text-[11px] leading-[18px]',
          'text-neutral-1000 dark:text-neutral-100',
          draft === '' && 'italic text-neutral-500 dark:text-neutral-500',
          className,
        )}
      >
        {draft === '' ? PLACEHOLDER : draft}
      </pre>
    )
  }

  return (
    // `nokey` opts these keystrokes out of @xyflow/react's window-level keydown
    // listener, which treats Space as a canvas pan-modifier and preventDefaults
    // it. xyflow exempts input/textarea/contenteditable, but Monaco's
    // EditContext surface is a plain div — so without this, Space never reaches
    // the editor. The POU-level editor carries the same marker.
    <div ref={containerRef} className={cn('nokey h-full w-full', className)}>
      <PrimitiveEditor
        language='st'
        path={uri}
        value={draft}
        onChange={(next) => {
          const text = next ?? ''
          dirtyRef.current = true
          draftRef.current = text
          setDraft(text)
          scheduleLspSync(text)
          onLineCountChange?.(text === '' ? 0 : text.split('\n').length)
        }}
        onMount={handleMount}
        options={{
          readOnly: effectiveReadOnly,
          domReadOnly: effectiveReadOnly,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          // Classic hidden-<textarea> input rather than the newer EditContext
          // surface — a real textarea is what xyflow's `isInputDOMNode`
          // recognises, so this reinforces `.nokey` above.
          editContext: false,
          automaticLayout: true,
          wordWrap: 'off',
          // Same indentation contract as every other Monaco surface in the
          // app — 4 spaces, no tabs, no detect-indentation heuristic.
          tabSize: 4,
          insertSpaces: true,
          detectIndentation: false,
          // Without this the LSP's semantic-tokens response is silently
          // dropped and ST loses variable/type colouring.
          'semanticHighlighting.enabled': true,
          ...(variant === 'full'
            ? {
                // Match the POU-level ST editor: gutter, same font size, and
                // room to breathe.
                fontSize: 12,
                lineNumbers: 'on',
                folding: true,
                padding: { top: 10, bottom: 10 },
                // Hovers / suggestions would otherwise clip inside the modal.
                fixedOverflowWidgets: true,
              }
            : {
                // In-rung: no gutter, minimal chrome, small type.
                fontSize: 11,
                lineHeight: 18,
                lineNumbers: 'off',
                glyphMargin: false,
                folding: false,
                lineDecorationsWidth: 0,
                lineNumbersMinChars: 0,
                overviewRulerLanes: 0,
                renderLineHighlight: 'none',
                padding: { top: 4, bottom: 4 },
                scrollbar: {
                  vertical: 'auto',
                  horizontal: 'auto',
                  verticalScrollbarSize: 8,
                  horizontalScrollbarSize: 8,
                },
                contextmenu: false,
              }),
        }}
      />
    </div>
  )
}
