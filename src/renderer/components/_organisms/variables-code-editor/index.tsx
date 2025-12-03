import Editor, { OnMount } from '@monaco-editor/react'
import { type editor as MonacoEditor } from 'monaco-editor'
import { useEffect, useRef, useState } from 'react'

interface VariablesCodeEditorProps {
  code: string
  onCodeChange: (code: string) => void
  shouldUseDarkMode: boolean
}

const VariablesCodeEditor = ({ code, onCodeChange, shouldUseDarkMode }: VariablesCodeEditorProps) => {
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [height, setHeight] = useState(1000)
  const [width, setWidth] = useState(1000)

  const handleEditorDidMount: OnMount = (editor) => {
    editorRef.current = editor
    editor.layout()
  }

  // Workaround to dynamically adjust the editor layout on container resize.
  // This issue occurs in older Electron/Chromium versions that don't properly handle layout updates.
  // Updating Electron may fix the issue by including a newer Chromium with improved resize handling.

  // https://issues.chromium.org/issues/391393420

  useEffect(() => {
    if (!containerRef.current) return

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        setWidth(width)
        setHeight(height)
        editorRef.current?.layout({ width, height })
      }
    })

    resizeObserver.observe(containerRef.current)

    return () => resizeObserver.disconnect()
  }, [])

  return (
    <div
      ref={containerRef}
      aria-label='Variable Code Editor Container'
      className='h-full w-full'
      style={{ overflow: 'hidden' }}
    >
      <Editor
        height={height}
        width={width}
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
        }}
        theme={shouldUseDarkMode ? 'openplc-dark' : 'openplc-light'}
      />
    </div>
  )
}

export { VariablesCodeEditor }
