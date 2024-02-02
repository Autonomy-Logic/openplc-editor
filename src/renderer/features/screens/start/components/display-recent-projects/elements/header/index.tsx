import { HTMLAttributes } from 'react'

export type RecentHeaderProps = HTMLAttributes<HTMLElement> & {
	title: string
}
export default function Header({ title }: RecentHeaderProps) {
	return (
		<header className='flex flex-1 w-full mb-6 justify-start text-xl font-caption font-medium text-neutral-1000 dark:text-white'>
			<h1 className='cursor-default'>{title}</h1>
		</header>
	)
}
