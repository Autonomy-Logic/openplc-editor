/* eslint-disable react/jsx-props-no-spreading */
import { HTMLAttributes, ReactNode } from 'react'

import { cn } from '~/utils'

type MenuSectionProps = HTMLAttributes<HTMLDivElement> & {
	children: ReactNode
}

export default function Section({ children, ...props }: MenuSectionProps) {
	const { className } = props
	const defaultStyle = 'flex'
	return (
		<section {...props} className={cn(defaultStyle, className)}>
			{children}{' '}
		</section>
	)
}
