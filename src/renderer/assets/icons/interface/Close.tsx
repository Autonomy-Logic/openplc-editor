import { ComponentPropsWithoutRef } from 'react'

const CloseIcon = (props: ComponentPropsWithoutRef<'svg'>) => {
	return (
		<svg
			viewBox='0 0 28 28'
			fill='none'
			xmlns='http://www.w3.org/2000/svg'
			{...props}
		>
			<title>Close Icon</title>
			<path
				d='M4 4L24 24M4 24L24 4'
				stroke='#0464FB'
				strokeWidth='1.5'
				strokeLinecap='round'
			/>
		</svg>
	)
}

export { CloseIcon }
