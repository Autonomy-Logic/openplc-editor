import { ReactNode } from 'react'
import { Panel } from 'react-resizable-panels'

export const EditorPanel = (): ReactNode => {
	return (
		<Panel className='flex-grow rounded-lg overflow-hidden flex flex-col border-2 border-neutral-200 bg-white dark:bg-neutral-950' />
	)
}
