import { ComponentProps } from 'react'
import { cn } from '@utils/cn'

type IFallBackIconProps = ComponentProps<'svg'> & {
	size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
	sm: 'w-4 h-4',
	md: 'w-8 h-8',
	lg: 'w-12 h-12',
}
export const FallBackIcon = (props: IFallBackIconProps) => {
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
				d='M23.2696 17.8042C24.8013 19.3359 24.8013 21.8194 23.2696 23.3512C21.7378 24.8829 19.2543 24.8829 17.7226 23.3512C16.1908 21.8194 16.1908 19.3359 17.7226 17.8042C19.2543 16.2724 21.7378 16.2724 23.2696 17.8042Z'
				stroke='#0464FB'
				strokeWidth='1.5'
				strokeLinecap='round'
				strokeLinejoin='round'
			/>
			<path
				fillRule='evenodd'
				clipRule='evenodd'
				d='M24.7948 8.34512L21.4138 11.7261C20.9028 12.2371 20.0756 12.2371 19.5646 11.7261L16.1836 8.34512C15.6738 7.83529 15.6738 7.00695 16.1836 6.49712L19.5646 3.11495C20.0756 2.60395 20.9028 2.60395 21.4138 3.11495L24.7948 6.49595C25.3046 7.00695 25.3046 7.83412 24.7948 8.34512Z'
				stroke='#0464FB'
				strokeWidth='1.5'
				strokeLinecap='round'
				strokeLinejoin='round'
			/>
			<path
				fillRule='evenodd'
				clipRule='evenodd'
				d='M5.03855 11.1183H9.81955C10.5417 11.1183 11.1274 10.5326 11.1274 9.81047V5.02947C11.1274 4.3073 10.5417 3.72163 9.81955 3.72163H5.03855C4.31638 3.72163 3.73071 4.3073 3.73071 5.02947V9.81047C3.73071 10.5326 4.31638 11.1183 5.03855 11.1183Z'
				stroke='#0464FB'
				strokeWidth='1.5'
				strokeLinecap='round'
				strokeLinejoin='round'
			/>
			<path
				fillRule='evenodd'
				clipRule='evenodd'
				d='M6.25774 17.682L3.35974 22.3206C2.78574 23.2388 3.44607 24.43 4.52874 24.43H10.3259C11.4086 24.43 12.0689 23.2388 11.4949 22.3206L8.59691 17.6831C8.05674 16.8186 6.79791 16.8186 6.25774 17.682Z'
				stroke='#0464FB'
				strokeWidth='1.5'
				strokeLinecap='round'
				strokeLinejoin='round'
			/>
		</svg>
	)
}
