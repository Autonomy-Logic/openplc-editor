import { ComponentProps } from 'react'
import { cn } from '@utils/cn'

type IResourceIconProps = ComponentProps<'svg'> & {
	size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
	sm: 'w-5 h-5',
	md: 'w-8 h-8',
	lg: 'w-12 h-12',
}
export const ResourceIcon = (props: IResourceIconProps) => {
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
			<path
				opacity='0.4'
				d='M10 12.3333C10 11.597 10.597 11 11.3333 11H16.6667C17.403 11 18 11.597 18 12.3333V17.6667C18 18.403 17.403 19 16.6667 19H11.3333C10.597 19 10 18.403 10 17.6667V12.3333Z'
				fill='white'
			/>
			<path
				fillRule='evenodd'
				clipRule='evenodd'
				d='M7.5 10.3333C7.5 9.32081 8.32081 8.5 9.33333 8.5H12C12.2761 8.5 12.5 8.72386 12.5 9C12.5 9.27614 12.2761 9.5 12 9.5H9.33333C8.8731 9.5 8.5 9.8731 8.5 10.3333V13C8.5 13.2761 8.27614 13.5 8 13.5C7.72386 13.5 7.5 13.2761 7.5 13V10.3333Z'
				fill='white'
			/>
			<path
				fillRule='evenodd'
				clipRule='evenodd'
				d='M20.5 19.6667C20.5 20.6792 19.6792 21.5 18.6667 21.5H16C15.7239 21.5 15.5 21.2761 15.5 21C15.5 20.7239 15.7239 20.5 16 20.5H18.6667C19.1269 20.5 19.5 20.1269 19.5 19.6667V17C19.5 16.7239 19.7239 16.5 20 16.5C20.2761 16.5 20.5 16.7239 20.5 17V19.6667Z'
				fill='white'
			/>
		</svg>
	)
}
