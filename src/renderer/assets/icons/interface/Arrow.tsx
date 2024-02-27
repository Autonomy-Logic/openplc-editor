import { ComponentProps } from 'react'
import { cn } from '~/utils'

type IArrowIconProps = ComponentProps<'svg'> & {
	variant?: 'default' | 'primary' | 'secondary'
	size?: 'sm' | 'md' | 'lg'
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

export const ArrowIcon = (props: IArrowIconProps) => {
	const { className, variant = 'default', size = 'sm', ...res } = props
	return (
		<svg
			role='button'
			viewBox='0 0 28 28'
			fill='none'
			xmlns='http://www.w3.org/2000/svg'
			aria-label='Arrow Icon'
			className={cn(
				`${variantClasses[variant]}`,
				`${sizeClasses[size]}`,
				className
			)}
			{...res}
		>
			<path
				d='M21 10.5L14 17.5L7 10.5'
				stroke='current-color'
				strokeWidth='1.5'
				strokeLinecap='round'
				strokeLinejoin='round'
			/>
		</svg>
	)
}
