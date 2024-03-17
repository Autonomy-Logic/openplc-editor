import { ComponentProps } from 'react'
import { cn } from '@utils/cn'

type IMagnifierIconProps = ComponentProps<'svg'> & {
	size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
	sm: 'w-5 h-5',
	md: 'w-8 h-8',
	lg: 'w-12 h-12',
}

export const MagnifierIcon = (props: IMagnifierIconProps) => {
	const { className, size = 'sm', ...res } = props
	return (
		<svg
			role='button'
			viewBox='0 0 28 28'
			fill='none'
			xmlns='http://www.w3.org/2000/svg'
			className={cn(`${sizeClasses[size]} stroke-white`, className)}
			{...res}
		>
			<path
				d='M21.5833 21.5833L25.6667 25.6667M24.5 13.4167C24.5 7.29551 19.5378 2.33333 13.4167 2.33333C7.29552 2.33333 2.33334 7.29551 2.33334 13.4167C2.33334 19.5378 7.29552 24.5 13.4167 24.5C19.5378 24.5 24.5 19.5378 24.5 13.4167Z'
				stroke='inherit'
				strokeWidth='1.5'
				strokeLinecap='round'
				strokeLinejoin='round'
			/>
		</svg>
	)
}
