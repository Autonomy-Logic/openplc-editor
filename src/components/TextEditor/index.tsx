import Editor from '@monaco-editor/react'
import { FC } from 'react'

import monacoConfig from './config/config'

monacoConfig()
const TextEditor: FC = () => {
  return <Editor height="100vh" defaultLanguage="st" theme="vs-dark" />
}

export default TextEditor
