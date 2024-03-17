import { ComponentProps } from 'react'
import { cn } from '@utils/cn'

type IFunctionBlockIconProps = ComponentProps<'svg'> & {
	size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
	sm: 'w-5 h-5',
	md: 'w-8 h-8',
	lg: 'w-12 h-12',
}
export const FunctionBlockIcon = (props: IFunctionBlockIconProps) => {
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
				d='M26 19.3333V11.1667C26 8.58934 23.851 6.5 21.2 6.5H18C16.9614 6.5 15.9509 6.1725 15.12 5.56667L12.88 3.93333C12.0491 3.3275 11.0386 3 10 3H6.8C4.14903 3 2 5.08934 2 7.66667V19.3333C2 21.9107 4.14903 24 6.8 24H21.2C23.851 24 26 21.9107 26 19.3333Z'
				fill='#023C97'
			/>
			<mask
				id='mask0_1_137'
				maskUnits='userSpaceOnUse'
				x='5'
				y='5'
				width='18'
				height='18'
			>
				<path d='M23 23V5L5 5V23H23Z' fill='white' />
			</mask>
			<g mask='url(#mask0_1_137)'>
				<path
					opacity='0.4'
					d='M17 14C17 16.7614 14.7614 19 12 19C9.23858 19 7 16.7614 7 14C7 11.2386 9.23858 9 12 9C14.7614 9 17 11.2386 17 14Z'
					fill='#B4D0FE'
				/>
				<path
					fillRule='evenodd'
					clipRule='evenodd'
					d='M18.1023 10.6023C18.3219 10.3826 18.6781 10.3826 18.8977 10.6023L21.8977 13.6022C22.0032 13.7077 22.0625 13.8508 22.0625 14C22.0625 14.1492 22.0032 14.2922 21.8978 14.3977L18.8978 17.3977C18.6781 17.6174 18.3219 17.6174 18.1023 17.3977C17.8826 17.1781 17.8826 16.8219 18.1023 16.6023L20.142 14.5625H11C10.6893 14.5625 10.4375 14.3106 10.4375 14C10.4375 13.6893 10.6893 13.4375 11 13.4375H20.142L18.1023 11.3977C17.8826 11.1781 17.8826 10.8219 18.1023 10.6023Z'
					fill='white'
				/>
			</g>
		</svg>
	)
}
