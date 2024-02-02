import { HTMLAttributes, ReactNode } from 'react'

export type StartScreenLayoutProps = HTMLAttributes<HTMLDivElement>

export default function Container(props: StartScreenLayoutProps): ReactNode {
	//pl-[92px] pr-[70px]
	return (
		<main
			className='w-full h-full flex  py-4 justify-evenly px-16 min-h-[624px] min-w-[1024px] '
			{...props}
		/>
	)
}
