import React, { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'

type IRowDropdownProps = {
	rowData: {
		id: number
		name: string
		class: string
		type: string
		localization: string
		initialValue: string
		option: string
		debug: string
		documentation: string
	}
	value: 'class' | 'type' | 'option'
}

export default function RowDropdown({ rowData, value }: IRowDropdownProps) {
	const optionsToShow = rowData[value]
	const [selectedOption, setSelectedOption] = useState()
	const [hoveredName, setHoveredName] = useState(null)

	const handleSelectOption = (option) => {
		setSelectedOption(option)
		setHoveredName(null)
	}

	const handleMouseEnter = (option) => {
		setHoveredName(option.name)
	}

	//submenu
	const renderSubContent = (option) => {
		if (option.name === hoveredName && option.value.length > 0) {
			return (
				<DropdownMenu.Portal>
					<DropdownMenu.SubContent
						sideOffset={2}
						alignOffset={-1}
						className='z-50 min-w-[220px] bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-850 dark:text-white text-neutral-400 font-normal text-xs'
					>
						{option.value.map((subItem, subIndex) => (
							<DropdownMenu.Item
								key={subIndex}
								onClick={() => handleSelectOption(subItem)}
								className={`hover:bg-neutral-100 dark:hover:bg-neutral-700 w-full focus:outline-none p-1
                cursor-pointer
              `}
							>
								{subItem}
							</DropdownMenu.Item>
						))}
					</DropdownMenu.SubContent>
				</DropdownMenu.Portal>
			)
		}
		return null
	}

	return (
		<DropdownMenu.Root>
			<DropdownMenu.Trigger asChild>
				<button
					type='button'
					className='w-full h-full items-center justify-center bg-inherit focus:outline-none'
					aria-label='Customize options'
				>
					{selectedOption || <p />}
				</button>
			</DropdownMenu.Trigger>

			<DropdownMenu.Portal>
				<DropdownMenu.Content
					className='z-50 w-[--radix-dropdown-menu-trigger-width] bg-white dark:bg-neutral-900 rounded-sm border border-neutral-300 dark:border-neutral-850 dark:text-white text-neutral-400 font-normal text-xs'
					align='start'
				>
					{optionsToShow.map((option, index) => (
						<DropdownMenu.Sub key={index}>
							<DropdownMenu.SubTrigger
								onMouseEnter={() => handleMouseEnter(option)}
								onClick={() => {
									if (option.value.length === 0) {
										handleSelectOption(option.name)
									}
								}}
								className={
									'hover:bg-neutral-100 dark:hover:bg-neutral-700  focus:outline-none capitalize cursor-pointer'
								}
							>
								{option.value.length === 0 ? (
									<DropdownMenu.Item className='w-full p-1 h-full cursor-pointer'>
										{option.name}
									</DropdownMenu.Item>
								) : (
									<p className='w-full p-1 h-full'>{option.name}</p>
								)}
							</DropdownMenu.SubTrigger>
							{renderSubContent(option)}
						</DropdownMenu.Sub>
					))}
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	)
}
