import { IconStyles } from '@process:renderer/data/constants/icon-styles'
import { cn } from '@utils/cn'
import { IIconProps } from '../Types/iconTypes'

export const TransferIcon = (props: IIconProps) => {
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
				d='M18.9993 0.333496H4.99935C2.42202 0.333496 0.332684 2.42283 0.332684 5.00016V19.0002C0.332684 21.5775 2.42202 23.6668 4.99935 23.6668H18.9993C21.5767 23.6668 23.666 21.5775 23.666 19.0002V5.00016C23.666 2.42283 21.5767 0.333496 18.9993 0.333496Z'
				fill='#B4D1FE'
			/>
			<path
				fillRule='evenodd'
				clipRule='evenodd'
				d='M17.4744 10.0017C17.339 10.3286 17.0199 10.5418 16.666 10.5418L7.33266 10.5418C6.84941 10.5418 6.45766 10.1501 6.45766 9.66683C6.45766 9.18358 6.84941 8.79183 7.33266 8.79183L14.5536 8.79183L13.7139 7.95221C13.3722 7.61051 13.3722 7.05649 13.7139 6.71478C14.0556 6.37307 14.6097 6.37307 14.9514 6.71478L17.2847 9.04811C17.535 9.29836 17.6098 9.67471 17.4744 10.0017Z'
				fill='#B4D1FE'
			/>
			<path
				fillRule='evenodd'
				clipRule='evenodd'
				d='M6.52464 13.9988C6.66007 13.6718 6.97913 13.4587 7.33303 13.4587L16.6664 13.4587C17.1496 13.4587 17.5414 13.8504 17.5414 14.3337C17.5414 14.8169 17.1496 15.2087 16.6664 15.2087L9.44547 15.2087L10.2851 16.0483C10.6268 16.39 10.6268 16.944 10.2851 17.2857C9.94338 17.6274 9.38936 17.6274 9.04765 17.2857L6.71432 14.9524C6.46407 14.7021 6.38921 14.3258 6.52464 13.9988Z'
				fill='#B4D1FE'
			/>
		</svg>
	)
}
