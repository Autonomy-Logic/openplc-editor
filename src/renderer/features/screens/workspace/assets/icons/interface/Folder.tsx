import { ComponentProps } from 'react'
import { cn } from '~/utils'

type IFolderIconProps = ComponentProps<'svg'> & {
	size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
	sm: 'w-5 h-5',
	md: 'w-8 h-8',
	lg: 'w-12 h-12',
}
export const FolderIcon = (props: IFolderIconProps) => {
	const { className, size = 'sm', ...res } = props
	return (
		<svg
			role='menuitem'
			viewBox='0 0 28 28'
			fill='none'
			xmlns='http://www.w3.org/2000/svg'
			className={cn(`${sizeClasses[size]}`, className)}
			{...res}
		>
			<path
				d='M2.33333 7.4375V20.5625C2.33333 21.6316 2.74344 22.6012 3.40912 23.3107L7.31595 14.4928C8.12697 12.5969 9.93657 11.375 11.9335 11.375H22.5455V10.0625C22.5455 7.88788 20.8488 6.125 18.7557 6.125H14.8431C14.1689 6.125 13.5068 5.9381 12.9253 5.58357L10.3956 4.04143C9.81401 3.6869 9.15195 3.5 8.47768 3.5H6.12312C4.03008 3.5 2.33333 5.26288 2.33333 7.4375Z'
				fill='#0464FB'
			/>
			<path
				opacity='0.4'
				d='M11.9332 11.375C9.9363 11.375 8.1267 12.5969 7.31568 14.4928L3.40885 23.3107C4.0972 24.0444 5.05882 24.5 6.12285 24.5H17.1577C18.9327 24.5 20.5775 23.5324 21.4907 21.9511L25.3025 15.3506C26.3128 13.6009 25.0998 11.375 23.136 11.375H11.9332Z'
				fill='#0464FB'
			/>
		</svg>
	)
}
