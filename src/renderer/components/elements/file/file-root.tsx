/* eslint-disable @typescript-eslint/no-explicit-any */
import { HTMLAttributes } from 'react'
import { cn } from '~/utils'

type FolderRootProps = HTMLAttributes<HTMLDivElement> & unknown
// {
//   size?: 'sm' | 'md' | 'lg';
// };

export default function Root({ ...props }: FolderRootProps) {
	const defaultStyle = 'flex relative w-[224px] h-[160px]'
	const { className } = props
	return (
		// eslint-disable-next-line react/jsx-props-no-spreading
		<div
			title='file-root'
			id='folder-root'
			{...props}
			className={cn(defaultStyle, className)}
		/>
	)
}
