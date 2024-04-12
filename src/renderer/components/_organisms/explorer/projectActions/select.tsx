import { useState } from 'react'
import * as Select from '@radix-ui/react-select'
import {
	ArrowIcon,
	FBDIcon,
	ILIcon,
	LDIcon,
	SFCIcon,
	STIcon,
} from '@root/renderer/assets'

export default function ProjectSelect() {
	const [selectedOption, setSelectedOption] = useState('Select a language')

	const options = [
		{
			name: 'Ladder Diagram',
			icon: <LDIcon size='sm' />,
		},
		{
			name: 'Sequential Functional Charts',
			icon: <SFCIcon size='sm' />,
		},
		{
			name: 'Functional Block Diagram',
			icon: <FBDIcon size='sm' />,
		},
		{
			name: 'Structured Text',
			icon: <STIcon size='sm' />,
		},
		{
			name: 'Intruction List',
			icon: <ILIcon size='sm' />,
		},
	]

	const getSelectedIcon = () => {
		const currentSelectedOption = options.find(
			(opt) => opt.name === selectedOption
		)
		return currentSelectedOption ? currentSelectedOption.icon : null
	}

	return (
		<Select.Root value={selectedOption} onValueChange={setSelectedOption}>
			<Select.Trigger className='h-[30px] px-2 py-1 flex items-center w-full outline-none border border-neutral-100 dark:border-brand-medium-dark font-medium text-cp-sm bg-white dark:bg-neutral-950 rounded-md'>
				<div className='w-full justify-between flex items-center'>
					<div className='w-full gap-1 flex items-center'>
						{getSelectedIcon()}
						<p className='font-caption text-cp-sm text-neutral-850 dark:text-neutral-300 font-medium'>
							{selectedOption}
						</p>
					</div>
					<Select.Icon>
						<ArrowIcon size='sm' className='stroke-brand rotate-270 ' />
					</Select.Icon>
				</div>
			</Select.Trigger>
			<Select.Content
				sideOffset={5}
				alignOffset={5}
				position='popper'
				align='center'
				side='bottom'
				className='dark:bg-neutral-950 w-[--radix-select-trigger-width] drop-shadow-lg overflow-hidden border h-fit bg-white border-neutral-100 dark:border-brand-medium-dark rounded-lg'
			>
				<Select.Viewport className='w-full h-full'>
					{options.map((language) => (
						<Select.Item
							key={language.name}
							value={language.name}
							className='px-2 py-[9px] cursor-pointer w-full hover:bg-neutral-100 dark:hover:bg-neutral-900 flex gap-2 items-center text-neutral-850 dark:text-neutral-300 font-medium'
						>
							{language.icon}

							<p className='font-caption text-cp-sm text-neutral-850 dark:text-neutral-300 font-medium'>
								{language.name}
							</p>
						</Select.Item>
					))}
				</Select.Viewport>
			</Select.Content>
		</Select.Root>
	)
}
