import { ComponentPropsWithRef } from 'react'

type WrapperProps = ComponentPropsWithRef<'aside'>

export const Wrapper = ({ ref, ...res }: WrapperProps) => {
	/**
	 * This probably will be replaced with a custom component
	 */
	return (
		<aside
			ref={ref}
			className='h-full flex flex-col w-52 rounded-lg border border-neutral-200'
			{...res}
		/>
	)
}
