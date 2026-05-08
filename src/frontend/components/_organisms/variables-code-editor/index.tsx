import Editor, { OnMount } from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { useEffect, useRef, useState } from 'react'

interface VariablesCodeEditorProps {
  code: string
  onCodeChange: (code: string) => void
  shouldUseDarkMode: boolean
  /**
   * Programmatic cursor jump (e.g. compile-error click → vars-text
   * view).  Applied on mount and whenever the value changes; the
   * caller is responsible for clearing it once the user takes over,
   * but a stale value is harmless because we only re-apply when it
   * actually differs from the editor's current position.
   */
  cursorPosition?: { lineNumber: number; column: number }
}

const VariablesCodeEditor = ({ code, onCodeChange, shouldUseDarkMode, cursorPosition }: VariablesCodeEditorProps) => {
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

  // Apply programmatic cursor jumps from the navigation hook.  Same
  // shape as the Monaco body editor: equality guard prevents redundant
  // reveal animations when the prop matches the editor's current
  // position (e.g. caller passes the same nav twice).
  useEffect(() => {
    if (!editorMounted || !cursorPosition) return
    const ed = editorRef.current
    if (!ed) return
    const current = ed.getPosition()
    if (current && current.lineNumber === cursorPosition.lineNumber && current.column === cursorPosition.column) {
      return
    }
    ed.setPosition(cursorPosition)
    ed.revealPositionInCenter(cursorPosition)
    ed.focus()
  }, [cursorPosition, editorMounted])

  return (
    <div
      ref={containerRef}
      aria-label='Variable Code Editor Container'
      className='h-full w-full'
      style={{ overflow: 'hidden' }}
    >
      <Editor
        height='100%'
        width='100%'
        language='st'
        defaultValue={''}
        value={code}
        onMount={handleEditorDidMount}
        onChange={(value) => onCodeChange(value ?? '')}
        options={{
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          fontSize: 14,
          tabSize: 2,
          inlineSuggest: { enabled: false },
          quickSuggestions: false,
        }}
        theme={shouldUseDarkMode ? 'openplc-dark' : 'openplc-light'}
      />
    </div>
  )
}

export { VariablesCodeEditor }
