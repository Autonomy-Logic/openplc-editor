import { ComponentProps } from 'react'
import { cn } from '~/utils'

type IPlusIconProps = ComponentProps<'svg'> & {
	size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
	sm: 'w-5 h-5',
	md: 'w-8 h-8',
	lg: 'w-12 h-12',
}

export const PlusIcon = (props: IPlusIconProps) => {
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
				d='M3.5 14H24.5M14 3.5V24.5'
				stroke='inherit'
				strokeWidth='1.5'
				strokeLinecap='round'
			/>
		</svg>
	)
}
