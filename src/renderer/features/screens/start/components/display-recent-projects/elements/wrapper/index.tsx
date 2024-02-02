import { HTMLAttributes, ReactNode } from 'react'

export type RecentWrapperProps = HTMLAttributes<HTMLDivElement>

export default function Wrapper({ children }: RecentWrapperProps): ReactNode {
	return (
		<section className='flex flex-col w-full h-1/2 2xl:h-3/5 3xl:h-3/4 4xl:h-4/5 pr-9 4xl:pr-0'>
			{children}
		</section>
	)
}
