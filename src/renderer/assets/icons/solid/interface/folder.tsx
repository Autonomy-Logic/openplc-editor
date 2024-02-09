import { ComponentProps } from 'react'
import { cn } from '~/utils'

type FolderIconProps = ComponentProps<'svg'>

export const FolderIcon = (props: FolderIconProps) => {
	const { className, ...res } = props
	return (
		<svg
			aria-label='Folder icon'
			role='button'
			viewBox='0 0 28 28'
			fill='none'
			xmlns='http://www.w3.org/2000/svg'
			className={cn('w-7 h-7', className)}
			{...res}
		>
			<path
				fill-rule='evenodd'
				clip-rule='evenodd'
				d='M24.4962 8.57555C24.4407 5.1985 23.7428 4.66667 20.0667 4.66667H13.2222L15.0889 6.06667C15.8967 6.6725 16.8792 7 17.8889 7H21C22.3917 7 23.6412 7.60923 24.4962 8.57555Z'
				fill='#0464FB'
			/>
			<path
				opacity='0.4'
				d='M25.6666 19.8333V11.6667C25.6666 9.08934 23.5773 7 21 7H17.8889C16.8791 7 15.8967 6.6725 15.0889 6.06667L12.9111 4.43333C12.1033 3.8275 11.1208 3.5 10.1111 3.5H6.99998C4.42265 3.5 2.33331 5.58934 2.33331 8.16667V19.8333C2.33331 22.4107 4.42265 24.5 6.99998 24.5H21C23.5773 24.5 25.6666 22.4107 25.6666 19.8333Z'
				fill='#0464FB'
			/>
		</svg>
	)
}
