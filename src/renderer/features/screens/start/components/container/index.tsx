import { HTMLAttributes, ReactNode } from 'react'

export type StartScreenLayoutProps = HTMLAttributes<HTMLDivElement>

export default function Container(props: StartScreenLayoutProps): ReactNode {
	return (
		<main
			className='w-full h-screen flex pl-[92px] pr-[70px] py-4'
			{...props}
		/>
	)
}
