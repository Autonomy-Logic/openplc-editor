import { ComponentPropsWithoutRef } from 'react'

type IWorkspaceMainContentProps = ComponentPropsWithoutRef<'div'>
const WorkspaceMainContent = (props: IWorkspaceMainContentProps) => {
	const { children, ...res } = props
	return (
		<div
			className='!rounded-tl-lg flex flex-1 flex-grow h-full w-full p-2 gap-1 bg-neutral-100 dark:bg-neutral-900'
			{...res}
		>
			{children}
		</div>
	)
}
export { WorkspaceMainContent }
