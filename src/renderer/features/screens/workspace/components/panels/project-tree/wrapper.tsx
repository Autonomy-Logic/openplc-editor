import { ComponentProps, ReactNode } from 'react'

type IWrapperProps = ComponentProps<'div'> & {
	children: Readonly<ReactNode>
}
export const Wrapper = (props: IWrapperProps): ReactNode => {
	const { children, ...res } = props
	return (
		<div
			className='w-full h-[45%] border-none bg-none overflow-auto flex flex-col '
			{...res}
		>
			{children}
		</div>
	)
}
