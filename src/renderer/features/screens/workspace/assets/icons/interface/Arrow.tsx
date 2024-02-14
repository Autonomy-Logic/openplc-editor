import { ComponentProps } from 'react'

type IArrowIconProps = ComponentProps<'svg'>

export const ArrowIcon = (props: IArrowIconProps) => {
	const { className, ...res } = props
	return (
		<svg
			role='button'
			viewBox='0 0 28 28'
			fill='none'
			xmlns='http://www.w3.org/2000/svg'
			aria-label='Arrow Icon'
			className={className}
			{...res}
		>
			<path
				d='M10.4998 6.99998L17.4998 14L10.4998 21'
				stroke='current-color'
				strokeWidth='1.5'
				strokeLinecap='round'
				strokeLinejoin='round'
			/>
		</svg>
	)
}
