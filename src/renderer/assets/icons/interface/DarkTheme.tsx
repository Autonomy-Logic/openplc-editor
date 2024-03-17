import React, { ComponentProps } from 'react'
import { IconStyles } from '@process:renderer/data/constants/icon-styles'
import { cn } from '@utils/cn'
import { IIconProps } from '../Types/iconTypes'

export const DarkThemeIcon = (props: IIconProps) => {
	const { className, size = 'md', ...res } = props
	const sizeClasses = IconStyles.sizeClasses.medium[size]
	return (
		<svg
			role='button'
			viewBox='0 0 44 24'
			fill='none'
			xmlns='http://www.w3.org/2000/svg'
			className={cn(`${sizeClasses}`, className)}
			{...res}
		>
			<g clipPath='url(#clip0_1958_12610)'>
				<rect width='44' height='24' rx='12' fill='#0464FB' />
				<g filter='url(#filter0_dd_1958_12610)'>
					<circle cx='32' cy='12' r='10' fill='white' />
				</g>
				<path
					opacity='0.4'
					d='M36.4552 13.2929C33.2806 13.2929 30.7071 10.7194 30.7071 7.54477C30.7071 6.96404 30.7932 6.40343 30.9534 5.875C28.5931 6.59038 26.875 8.78298 26.875 11.3769C26.875 14.5515 29.4485 17.125 32.6231 17.125C35.217 17.125 37.4096 15.4069 38.125 13.0466C37.5966 13.2068 37.036 13.2929 36.4552 13.2929Z'
					fill='#0464FB'
				/>
			</g>
			<defs>
				<filter
					id='filter0_dd_1958_12610'
					x='19'
					y='0'
					width='26'
					height='26'
					filterUnits='userSpaceOnUse'
					colorInterpolationFilters='sRGB'
				>
					<feFlood floodOpacity='0' result='BackgroundImageFix' />
					<feColorMatrix
						in='SourceAlpha'
						type='matrix'
						values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
						result='hardAlpha'
					/>
					<feOffset dy='1' />
					<feGaussianBlur stdDeviation='1' />
					<feColorMatrix
						type='matrix'
						values='0 0 0 0 0.0627451 0 0 0 0 0.0941176 0 0 0 0 0.156863 0 0 0 0.06 0'
					/>
					<feBlend
						mode='normal'
						in2='BackgroundImageFix'
						result='effect1_dropShadow_1958_12610'
					/>
					<feColorMatrix
						in='SourceAlpha'
						type='matrix'
						values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
						result='hardAlpha'
					/>
					<feOffset dy='1' />
					<feGaussianBlur stdDeviation='1.5' />
					<feColorMatrix
						type='matrix'
						values='0 0 0 0 0.0627451 0 0 0 0 0.0941176 0 0 0 0 0.156863 0 0 0 0.1 0'
					/>
					<feBlend
						mode='normal'
						in2='effect1_dropShadow_1958_12610'
						result='effect2_dropShadow_1958_12610'
					/>
					<feBlend
						mode='normal'
						in='SourceGraphic'
						in2='effect2_dropShadow_1958_12610'
						result='shape'
					/>
				</filter>
				<clipPath id='clip0_1958_12610'>
					<rect width='44' height='24' rx='12' fill='white' />
				</clipPath>
			</defs>
		</svg>
	)
}
