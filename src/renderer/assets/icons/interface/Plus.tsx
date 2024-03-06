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
			viewBox='0 0 18 18'
			fill='none'
			xmlns='http://www.w3.org/2000/svg'
			className={cn(`${sizeClasses[size]}`, className)}
			{...res}
		>
			<path
				d='M1.5 9H16.5M9 1.5L9 16.5'
				stroke='inherit'
				strokeWidth='1.5'
				strokeLinecap='round'
			/>
		</svg>
	)
}
