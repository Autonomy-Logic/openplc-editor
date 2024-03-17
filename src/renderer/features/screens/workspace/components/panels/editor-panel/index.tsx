import { ReactNode } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import VariableTable from './variable-table'
import TextEditor from '@features/editors/textual'

export const EditorPanel = (): ReactNode => {
	return (
		<Panel className='flex-grow rounded-lg overflow-hidden flex flex-col border-2 border-neutral-200 bg-white dark:bg-neutral-950 dark:border-neutral-800 p-4'>
			<PanelGroup
				className='w-full h-full flex flex-col gap-2 '
				direction='vertical'
			>
				<VariableTable />
				<div className='w-full flex justify-center '>
					<PanelResizeHandle
						title='Resize'
						className='h-[1px] bg-brand-light w-full'
					/>
				</div>
				<Panel>
					<TextEditor />
				</Panel>
			</PanelGroup>
		</Panel>
	)
}
