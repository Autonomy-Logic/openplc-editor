import { ComponentProps } from 'react'
import { cn } from '~/utils'

type IStickArrowIconProps = ComponentProps<'svg'> & {
	size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
	sm: 'w-5 h-5',
	md: 'w-8 h-8',
	lg: 'w-12 h-12',
}

export const StickArrowIcon = (props: IStickArrowIconProps) => {
	const { className, size = 'sm', ...res } = props
	return (
		<svg
			role='button'
			viewBox='0 0 28 28'
			fill='none'
			xmlns='http://www.w3.org/2000/svg'
			className={cn(`${sizeClasses[size]}`, className)}
			{...res}
		>
			<path
				d='M22.1667 13.9999H5.8333M22.1667 13.9999L15.3611 6.9999M22.1667 13.9999L15.3611 20.9999'
				stroke='#0464FB'
				strokeWidth='1.5'
				strokeLinecap='round'
				strokeLinejoin='round'
			/>
		</svg>
	)
}
