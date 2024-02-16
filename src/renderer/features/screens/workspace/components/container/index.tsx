import { ComponentProps, ReactNode } from 'react'
import { cn } from '~/utils'

type IWorkspaceContainerRootProps = ComponentProps<'div'> & {
	children: Readonly<ReactNode>
}

export const ContainerComponent = (
	props: IWorkspaceContainerRootProps
): ReactNode => {
	const { children, className, ...res } = props
	return (
		<div
			role='main'
			className={cn(
				'containerWrapper bg-[#011E4B] flex h-full items-center w-full',
				className
			)}
			{...res}
		>
			{children}
		</div>
	)
}
