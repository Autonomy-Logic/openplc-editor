import { ButtonHTMLAttributes } from 'react'

export type ExamplePrevButtonProps = ButtonHTMLAttributes<HTMLButtonElement>
export default function PrevButton(props: ExamplePrevButtonProps) {
	const { ...restProps } = props

	return (
		<button type='button' aria-label='Previous button' {...restProps}>
			<svg
				width='24'
				height='24'
				fill='none'
				xmlns='http://www.w3.org/2000/svg'
			>
				<path
					d='M5 12.0001L19 12.0001M5 12.0001L10.8333 18.0001M5 12.0001L10.8333 6.00006'
					stroke='#0464FB'
					strokeWidth='1.5'
					strokeLinecap='round'
					strokeLinejoin='round'
				/>
			</svg>
		</button>
	)
}

export type ExamplePrevButton = typeof PrevButton
