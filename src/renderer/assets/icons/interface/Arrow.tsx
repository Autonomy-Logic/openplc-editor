import { ComponentPropsWithRef, ElementType } from 'react'
import { cn } from '@utils/cn'

type IArrowIconProps = ComponentPropsWithRef<'svg'> & {
	variant?: 'default' | 'primary' | 'secondary'
	direction?: 'up' | 'down' | 'left' | 'right'
	size?: 'sm' | 'md' | 'lg'
}

const directionClasses = {
	left: 'rotate-0',
	up: 'rotate-90',
	right: 'rotate-180',
	down: 'rotate-270',
}

const variantClasses = {
	default: 'stroke-brand-light',
	primary: 'stroke-brand',
	secondary: 'stroke-brand-medium-dark',
}

const sizeClasses = {
	sm: 'w-4 h-4',
	md: 'w-6 h-6',
	lg: 'w-8 h-8',
}

export const ArrowIcon: ElementType<IArrowIconProps> = ({
	className,
	variant = 'default',
	size = 'sm',
	direction = 'left',
	ref,
	...res
}) => {
	return (
		<svg
			role='button'
			viewBox='0 0 28 28'
			fill='none'
			xmlns='http://www.w3.org/2000/svg'
			aria-label='Arrow Icon'
			className={cn(
				`${variantClasses[variant]}`,
				`${directionClasses[direction]}`,
				`${sizeClasses[size]}`,
				className
			)}
			ref={ref}
			{...res}
		>
			<path
				d='M17.5002 21L10.5002 14L17.5002 7'
				stroke='current-color'
				strokeWidth='1.5'
				strokeLinecap='round'
				strokeLinejoin='round'
			/>
		</svg>
	)
}
