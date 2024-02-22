/* eslint-disable react/jsx-props-no-spreading */
import {
	ButtonHTMLAttributes,
	Dispatch,
	ElementType,
	ReactNode,
	SetStateAction,
} from 'react'

import { cn } from '~/utils'

type DropdownSelectProps = ButtonHTMLAttributes<HTMLButtonElement> & {
	selectedOption: string
	Icon?: ElementType
	setShowOptions: Dispatch<SetStateAction<boolean>>
	showOptions: boolean
	placeholder: string
}
export default function Select({
	selectedOption,
	Icon,
	setShowOptions,
	showOptions,
	placeholder,
	className,
	...props
}: DropdownSelectProps) {
	return (
		<button
			type='button'
			data-testid='dropdown-icon'
			className={cn('select-none', className)}
			onClick={() => setShowOptions(!showOptions)}
			{...props}
		>
			{placeholder}
			<p className='flex items-center justify-between w-28'>
				<span className='text-black '>{selectedOption}</span>
				{Icon && (
					<Icon
						size='md'
						variant='primary'
						className={cn(
							`${
								showOptions ? '-rotate-180' : 'rotate-0'
							} stroke-brand inline transition-all`
						)}
					/>
				)}
			</p>
		</button>
	)
}
