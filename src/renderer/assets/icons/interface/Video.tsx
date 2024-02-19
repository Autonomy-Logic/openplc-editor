import { ComponentProps } from 'react'
import { cn } from '~/utils'

type IVideoIconProps = ComponentProps<'svg'> & {
	size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
	sm: 'w-5 h-5',
	md: 'w-8 h-8',
	lg: 'w-12 h-12',
}
export const VideoIcon = (props: IVideoIconProps) => {
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
				opacity='0.4'
				d='M2.33331 9.33333C2.33331 6.75601 4.42265 4.66667 6.99998 4.66667H15.1666C17.744 4.66667 19.8333 6.75601 19.8333 9.33333V18.6667C19.8333 21.244 17.744 23.3333 15.1666 23.3333H6.99998C4.42265 23.3333 2.33331 21.244 2.33331 18.6667V9.33333Z'
				fill='#0464FB'
			/>
			<path
				d='M19.8333 12.4707C19.8333 11.4545 20.2201 10.4764 20.9152 9.73498L21.6311 8.97135C23.0778 7.4282 25.6666 8.45197 25.6666 10.5672V17.4329C25.6666 19.5482 23.0778 20.5719 21.6311 19.0288L20.9152 18.2652C20.2201 17.5238 19.8333 16.5456 19.8333 15.5294V12.4707Z'
				fill='#0464FB'
			/>
			<path
				d='M12.8333 14C14.122 14 15.1666 12.9554 15.1666 11.6667C15.1666 10.378 14.122 9.33337 12.8333 9.33337C11.5446 9.33337 10.5 10.378 10.5 11.6667C10.5 12.9554 11.5446 14 12.8333 14Z'
				fill='#0464FB'
			/>
		</svg>
	)
}
