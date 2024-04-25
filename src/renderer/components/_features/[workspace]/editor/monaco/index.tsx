import './configs'

import { Editor as PrimitiveEditor } from '@monaco-editor/react'
import { useOpenPLCStore } from '@process:renderer/store'

const MonacoEditor = (): ReturnType<typeof PrimitiveEditor> => {
  const { path, language, value, shouldUseDarkMode } = useOpenPLCStore()
  return (
    <PrimitiveEditor
      height='100%'
      width='100%'
      path={path}
      language={language}
      defaultValue={value}
      theme={shouldUseDarkMode ? 'openplc-dark' : 'openplc-light'}
    />
  )
}
export { MonacoEditor }
