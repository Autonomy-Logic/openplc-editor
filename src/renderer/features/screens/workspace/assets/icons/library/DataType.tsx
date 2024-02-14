import { ComponentProps } from 'react'

type IDataTypeIconProps = ComponentProps<'svg'>

export const DataTypeIcon = (props: IDataTypeIconProps) => {
	const { className, ...res } = props
	return (
		<svg
			role='button'
			viewBox='0 0 28 28'
			fill='none'
			xmlns='http://www.w3.org/2000/svg'
		>
			<path
				d='M26 19.3333V11.1667C26 8.58934 23.851 6.5 21.2 6.5H18C16.9614 6.5 15.9509 6.1725 15.12 5.56667L12.88 3.93333C12.0491 3.3275 11.0386 3 10 3H6.8C4.14903 3 2 5.08934 2 7.66667V19.3333C2 21.9107 4.14903 24 6.8 24H21.2C23.851 24 26 21.9107 26 19.3333Z'
				fill='#023C97'
			/>
			<path
				d='M14 10L9 12.5L14 15L19 12.5L14 10Z'
				fill='white'
				stroke='white'
				stroke-linecap='round'
				stroke-linejoin='round'
			/>
			<path
				opacity='0.4'
				d='M9 17.5L14 20L19 17.5'
				stroke='#B4D0FE'
				stroke-linecap='round'
				stroke-linejoin='round'
			/>
			<path
				opacity='0.4'
				d='M9 15L14 17.5L19 15'
				stroke='#B4D0FE'
				stroke-linecap='round'
				stroke-linejoin='round'
			/>
		</svg>
	)
}
