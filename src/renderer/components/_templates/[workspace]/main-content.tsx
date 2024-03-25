import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@root/utils'
import { ComponentPropsWithoutRef } from 'react'

type IWorkspaceMainContentProps = ComponentPropsWithoutRef<'div'>
const WorkspaceMainContent = (props: IWorkspaceMainContentProps) => {
	const platform = useOpenPLCStore().OS
	const { children, ...res } = props
	return (
		<div
			className={cn(
				'flex flex-1 flex-grow h-full w-full p-2 gap-1 bg-neutral-100 dark:bg-neutral-900',
				`${platform !== 'linux' && '!rounded-tl-lg'}`
			)}
			{...res}
		>
			{children}
		</div>
	)
}
export { WorkspaceMainContent }
