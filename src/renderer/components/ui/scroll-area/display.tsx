import { ForwardedRef, HTMLAttributes, forwardRef } from 'react'

import { cn } from '@utils/cn'

type CustomDisplayProps = HTMLAttributes<HTMLDivElement>

const CustomDisplay = forwardRef(
	(
		{ className, children, ...props }: CustomDisplayProps,
		ref: ForwardedRef<HTMLDivElement>
	) => (
		<div
			ref={ref}
			className={cn(
				'h-full w-full rounded-[inherit] grid grid-cols-4 gap-6 pr-5',
				className
			)}
			{...props}
		>
			{children}
		</div>
	)
)

CustomDisplay.displayName = 'CustomDisplay'

// eslint-disable-next-line import/prefer-default-export
export { CustomDisplay }
