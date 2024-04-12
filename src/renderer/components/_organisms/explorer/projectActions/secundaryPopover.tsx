import React from 'react'
import * as Popover from '@radix-ui/react-popover'
import {
	ArrowIcon,
	FunctionBlockIcon,
	FunctionIcon,
	ProgramIcon,
} from '@root/renderer/assets'
import ProjectSelect from './select'
import { cn } from '@root/utils'

export default function SecundaryPopover() {
	const projectOptions = {
		Function: {
			name: 'Function',
			type: 'Function',
			icon: <FunctionIcon size='md' />,
			hasChildren: true,
		},
		Function_Block: {
			name: 'Function Block',
			type: 'Function Block',
			icon: <FunctionBlockIcon size='md' />,
			hasChildren: true,
		},
		Program: {
			name: 'Program',
			type: 'Program',
			icon: <ProgramIcon size='md' />,
			hasChildren: true,
		},
	}

	const buttonDefaultStyle =
		'font-caption w-[88px] h-7 rounded-md  font-medium text-cp-sm'
	const labelsDefaultStyle =
		'text-cp-sm font-medium text-neutral-1000 dark:text-neutral-50'
	const itemsPositionDefaultStyle = 'w-full flex flex-col gap-[6px]'

	return (
		<>
			{Object.entries(projectOptions).map(([key, value]) => (
				<Popover.Root key={key}>
					<div className='h-full w-full relative z-9'>
						<Popover.Trigger className='w-full' asChild>
							<button
								type='button'
								className='data-[state=open]:bg-neutral-100 justify-between dark:data-[state=open]:bg-neutral-900 relative flex items-center w-full h-7 gap-1 rounded-lg cursor-default select-none hover:bg-neutral-100 p-2 dark:hover:bg-neutral-900'
							>
								<div className='flex items-center w-full h-full gap-2'>
									{value.icon}
									<p className={labelsDefaultStyle}>{value.name}</p>
								</div>

								<ArrowIcon className='rotate-180 ' />
							</button>
						</Popover.Trigger>
						<Popover.Content
							sideOffset={14}
							alignOffset={-7}
							align='start'
							side='right'
							className='flex flex-col drop-shadow-lg pb-3 px-3 pt-2 gap-3 w-[225px] h-fit border border-brand-light dark:border-brand-medium-dark bg-white dark:bg-neutral-950 p-2 rounded-lg'
						>
							<div className='flex items-center w-full h-8 flex-col justify-between'>
								<div className='flex w-full items-center gap-2'>
									{value.icon}
									<p className={labelsDefaultStyle}>{value.name}</p>
								</div>
								<div className='bg-neutral-200 dark:!bg-neutral-850 h-[1px] w-full' />
							</div>
							<div className={itemsPositionDefaultStyle}>
								<p className={labelsDefaultStyle}>POU name:</p>
								<input
									type='text'
									placeholder='POU name'
									className='px-2 w-full dark:text-neutral-300  outline-none border border-neutral-100 dark:border-brand-medium-dark text-neutral-850 font-medium text-cp-sm bg-white dark:bg-neutral-950 py-2 h-[30px] rounded-md'
								/>
							</div>
							<div className={itemsPositionDefaultStyle}>
								<p className={labelsDefaultStyle}>Language:</p>
								<ProjectSelect />
							</div>

							<div className='w-full flex justify-between'>
								<button
									type='button'
									className={cn('!text-white bg-brand', buttonDefaultStyle)}
								>
									Create
								</button>
								<button
									type='button'
									className={cn(
										' bg-neutral-100  !text-neutral-1000',
										buttonDefaultStyle
									)}
								>
									Cancel
								</button>
							</div>
						</Popover.Content>
					</div>
				</Popover.Root>
			))}
		</>
	)
}
