import Editor, { OnMount } from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { useRef } from 'react'

interface VariablesCodeEditorProps {
  code: string
  onCodeChange: (code: string) => void
  shouldUseDarkMode: boolean
}

const VariablesCodeEditor = ({ code, onCodeChange, shouldUseDarkMode }: VariablesCodeEditorProps) => {
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)

  const handleEditorDidMount: OnMount = (editor) => {
    editorRef.current = editor
  }

  return (
    <div aria-label='Variable Code Editor Container' className='h-full w-full'>
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
        }}
        theme={shouldUseDarkMode ? 'openplc-dark' : 'openplc-light'}
      />
    </div>
  )
}

export { VariablesCodeEditor }
