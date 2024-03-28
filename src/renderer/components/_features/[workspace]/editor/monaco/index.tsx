import './configs'

import * as monaco from 'monaco-editor'
import { Editor as PrimitiveEditor } from '@monaco-editor/react'
import { useOpenPLCStore } from '@process:renderer/store'

const MonacoEditor = (): ReturnType<typeof PrimitiveEditor> => {
	const { path, language, value, colorScheme } = useOpenPLCStore()
	return (
		<PrimitiveEditor
			height='100%'
			width='100%'
			path={path}
			language={language}
			defaultValue={value}
			theme={colorScheme === 'dark' ? 'openplc-dark' : 'openplc-light'}
		/>
	)
}
export { MonacoEditor }
