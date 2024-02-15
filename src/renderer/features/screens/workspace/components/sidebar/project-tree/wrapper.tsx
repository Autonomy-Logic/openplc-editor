import { ComponentProps, ReactNode } from 'react'

type IWrapperProps = ComponentProps<'div'> & {
	children: Readonly<ReactNode>
}
export const Wrapper = (props: IWrapperProps): ReactNode => {
	const { children, ...res } = props
	return (
		<div
			className='w-full h-1/2 border-none bg-neutral-50 dark:bg-neutral-950'
			{...res}
		>
			{children}
		</div>
	)
}
