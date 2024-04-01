import { ComponentPropsWithoutRef } from 'react'

type IWorkspaceSideContentProps = ComponentPropsWithoutRef<'div'>
const WorkspaceSideContent = (props: IWorkspaceSideContentProps) => {
	const { children, ...res } = props
	return (
		<div
			className='bg-brand-dark dark:bg-neutral-950 h-full w-14 flex flex-col justify-between pb-10 border-t-inherit'
			{...res}
		>
			{children}
		</div>
	)
}

export { WorkspaceSideContent }
