import React, { ComponentProps } from 'react'
import { IconStyles } from '@process:renderer/data/constants/icon-styles'
import { cn } from '@utils/cn'
import { IIconProps } from '../Types/iconTypes'

export const ZoomInOut = (props: IIconProps) => {
	const { className, size = 'sm', ...res } = props
	const sizeClasses = IconStyles.sizeClasses.small[size]
	return (
		<svg
			role='button'
			viewBox='0 0 24 24'
			fill='none'
			xmlns='http://www.w3.org/2000/svg'
			className={cn(`${sizeClasses}`, className)}
			{...res}
		>
			<path
				opacity='0.4'
				d='M4.99967 0.333374H18.9997C21.577 0.333374 23.6663 2.42271 23.6663 5.00004V19C23.6663 21.5774 21.577 23.6667 18.9997 23.6667H4.99967C2.42235 23.6667 0.333008 21.5774 0.333008 19V5.00004C0.333008 2.42271 2.42235 0.333374 4.99967 0.333374Z'
				fill='#B4D0FE'
			/>
			<path
				fillRule='evenodd'
				clipRule='evenodd'
				d='M13.1663 8.20837C12.6831 8.20837 12.2913 7.81662 12.2913 7.33337C12.2913 6.85012 12.6831 6.45837 13.1663 6.45837H16.6663C17.1496 6.45837 17.5413 6.85012 17.5413 7.33337V10.8334C17.5413 11.3166 17.1496 11.7084 16.6663 11.7084C16.1831 11.7084 15.7913 11.3166 15.7913 10.8334V9.44581L9.44544 15.7917H10.833C11.3163 15.7917 11.708 16.1835 11.708 16.6667C11.708 17.15 11.3163 17.5417 10.833 17.5417H7.33301C6.84976 17.5417 6.45801 17.15 6.45801 16.6667V13.1667C6.45801 12.6835 6.84976 12.2917 7.33301 12.2917C7.81626 12.2917 8.20801 12.6835 8.20801 13.1667V14.5543L14.5539 8.20837H13.1663Z'
				fill='#B4D0FE'
			/>
		</svg>
	)
}
