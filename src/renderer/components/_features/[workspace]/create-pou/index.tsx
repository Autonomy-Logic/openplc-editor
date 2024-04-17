import * as Popover from '@radix-ui/react-popover'
import {
	ArrowIcon,
	FBDIcon,
	FunctionBlockIcon,
	FunctionIcon,
	ILIcon,
	LDIcon,
	PlusIcon,
	ProgramIcon,
	SFCIcon,
	STIcon,
} from '@root/renderer/assets'
import { InputWithRef } from '@root/renderer/components/_atoms'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from '@components/_atoms/select'
import { useOpenPLCStore } from '@root/renderer/store'
import { IFunction, IFunctionBlock, IProgram } from '@root/types/PLC'
import _ from 'lodash'
import { ReactElement, useState } from 'react'
import { Controller, SubmitHandler, useForm } from 'react-hook-form'

type PouProps = {
	'pou-type': 'function' | 'function-block' | 'program'
	'pou-name': string
	'pou-language':
		| 'ladder-diagram'
		| 'sequential-functional-chart'
		| 'functional-block-diagram'
		| 'structured-text'
		| 'instruction-list'
}
type IPouDTO =
	| {
			type: 'program'
			data: IProgram
	  }
	| {
			type: 'function'
			data: IFunction
	  }
	| {
			type: 'function-block'
			data: IFunctionBlock
	  }
const CreatePou = () => {
	// const [isContainerOpen, setIsContainerOpen] = useState(false)
	// const [isFormOpen, setIsFormOpen] = useState(false)
	const { control, register, handleSubmit } = useForm<PouProps>()
	const { workspaceActions } = useOpenPLCStore()

	const convertToShortenedFormat = (
		str: string
	): 'LD' | 'SFC' | 'FBD' | 'ST' | 'IL' => {
		const draft = str.split('-')
		const initial = draft.map((word) => word.charAt(0).toUpperCase()).join('')
		return initial as 'LD' | 'SFC' | 'FBD' | 'ST' | 'IL'
	}

	const createNormalizedPou = (data: PouProps): IPouDTO => {
		switch (data['pou-type']) {
			case 'function':
				return {
					type: 'function',
					data: {
						name: data['pou-name'],
						language: convertToShortenedFormat(data['pou-language']),
						returnType: 'BOOL',
					},
				}
			case 'function-block':
				return {
					type: 'function-block',
					data: {
						name: data['pou-name'],
						language: convertToShortenedFormat(data['pou-language']),
					},
				}
			case 'program':
				return {
					type: 'program',
					data: {
						name: data['pou-name'],
						language: convertToShortenedFormat(data['pou-language']),
					},
				}
		}
	}
	/** Todo: add a function to create a pou in the app store */
	const onSubmit: SubmitHandler<PouProps> = (data) => {
		workspaceActions.createPou(createNormalizedPou(data))
	}
	const CreatePouSources: {
		id: number
		label: 'function' | 'function-block' | 'program'
		icon: ReactElement
	}[] = [
		{
			id: 0,
			label: 'function',
			icon: <FunctionIcon size='sm' />,
		},
		{
			id: 1,
			label: 'function-block',
			icon: <FunctionBlockIcon size='sm' />,
		},
		{
			id: 2,
			label: 'program',
			icon: <ProgramIcon size='sm' />,
		},
	]
	const PouLanguageSources = [
		{
			icon: <LDIcon />,
			value: 'Ladder Diagram',
		},

		{
			icon: <SFCIcon />,
			value: 'Sequential Functional Chart',
		},

		{
			icon: <FBDIcon />,
			value: 'Functional Block Diagram',
		},

		{
			icon: <STIcon />,
			value: 'Structured Text',
		},
		{
			icon: <ILIcon />,
			value: 'Instruction List',
		},
	]
	return (
		<Popover.Root>
			<Popover.Trigger
				id='create-pou-trigger'
				type='button'
				className='w-10 h-8 rounded-lg bg-brand flex justify-center items-center'
			>
				<PlusIcon className='stroke-white' />
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Content
					alignOffset={-7}
					sideOffset={10}
					align='end'
					className='w-[188px] h-fit shadow-card dark:shadow-dark-card border border-brand-light dark:border-brand-medium-dark bg-white dark:bg-neutral-950 p-2 rounded-lg flex flex-col gap-2'
				>
					{CreatePouSources.map(({ id, label, icon }) => (
						<Popover.Root key={id}>
							<Popover.Trigger id={`create-${label}-trigger`}>
								<div
									id={`create-${label}-trigger-container`}
									className='data-[state=open]:bg-neutral-100 py-[2px] px-[6px] justify-between dark:data-[state=open]:bg-neutral-900 relative flex items-center w-full h-7 gap-[6px] rounded-md cursor-pointer select-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
								>
									{icon}
									<p className='text-start font-caption text-xs font-normal text-neutral-1000 dark:text-neutral-300 flex-1 my-[2px]'>
										{_.startCase(label)}
									</p>
									<ArrowIcon size='md' direction='right' />
								</div>
							</Popover.Trigger>
							<Popover.Portal>
								<Popover.Content
									id={`create-${label}-content`}
									sideOffset={14}
									alignOffset={-7}
									align='start'
									side='right'
								>
									<div
										id='pou-card-root'
										className='flex flex-col drop-shadow-lg pb-3 px-3 pt-2 gap-3 w-[225px] h-fit border border-brand-light dark:border-brand-medium-dark bg-white dark:bg-neutral-950 p-2 rounded-lg'
									>
										<div
											id='pou-card-label-container'
											className='flex items-center w-full h-8 flex-col justify-between'
										>
											<div className='flex w-full items-center gap-2'>
												{icon}
												<p className='text-start font-caption text-xs font-normal text-neutral-1000 dark:text-neutral-300 flex-1 my-[2px]'>
													{label}
												</p>
											</div>
											<div className='bg-neutral-200 dark:!bg-neutral-850 h-[1px] w-full' />
										</div>
										<div id='pou-card-form'>
											<form
												onSubmit={handleSubmit(onSubmit)}
												className='flex flex-col pb-3 pt-2 gap-3 w-full h-fit'
											>
												<input
													type='hidden'
													{...register('pou-type')}
													value={label}
												/>
												<div
													id='pou-name-form-container'
													className='flex flex-col w-full gap-[6px] '
												>
													<label
														id='pou-name-label'
														htmlFor='pou-name'
														className='text-start font-caption text-xs font-normal text-neutral-1000 dark:text-neutral-300 flex-1 my-[2px]'
													>
														POU name:
													</label>
													<InputWithRef
														{...register('pou-name')}
														id='pou-name'
														type='text'
														placeholder='POU name'
														className='px-2 w-full dark:text-neutral-300  outline-none border border-neutral-100 dark:border-brand-medium-dark text-neutral-850 font-medium text-cp-sm bg-white dark:bg-neutral-950 py-2 h-[30px] rounded-md'
													/>
												</div>
												<div
													id='pou-language-form-container'
													className='flex flex-col w-full gap-[6px] '
												>
													<label
														id='pou-language-label'
														htmlFor='pou-language'
														className='text-start font-caption text-xs font-normal text-neutral-1000 dark:text-neutral-300 flex-1 my-[2px]'
													>
														Language:
													</label>
													<Controller
														name='pou-language'
														control={control}
														render={({ field: { value, onChange } }) => {
															return (
																<Select value={value} onValueChange={onChange}>
																	<SelectTrigger
																		id='pou-language'
																		aria-label='pou-language'
																		placeholder='Select a language'
																		className='w-full h-[30px] px-2 py-1 gap-1 flex items-center justify-between outline-none border border-neutral-100 dark:border-brand-medium-dark font-caption font-medium text-cp-sm bg-white dark:bg-neutral-950 rounded-md text-neutral-850 dark:text-neutral-300'
																	/>
																	<SelectContent
																		className='dark:bg-neutral-950 w-[--radix-select-trigger-width] drop-shadow-lg overflow-hidden border h-fit bg-white border-neutral-100 dark:border-brand-medium-dark rounded-lg'
																		sideOffset={5}
																		alignOffset={5}
																		position='popper'
																		align='center'
																		side='bottom'
																	>
																		{PouLanguageSources.map((lang) => {
																			return (
																				<SelectItem
																					key={lang.value}
																					className='w-full px-2 py-[9px] cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-900 flex items-center'
																					value={_.kebabCase(lang.value)}
																				>
																					<span className='flex items-center  font-caption text-cp-sm gap-2 text-neutral-850 dark:text-neutral-300 font-medium'>
																						{lang.icon}{' '}
																						<span>{lang.value}</span>
																					</span>
																				</SelectItem>
																			)
																		})}
																	</SelectContent>
																</Select>
															)
														}}
													/>
												</div>
												<div
													id='form-button-container'
													className='w-full flex justify-between'
												>
													<button
														type='submit'
														className='!text-white bg-brand font-caption w-[88px] h-7 rounded-md  font-medium text-cp-sm'
													>
														Create
													</button>
													<button
														type='button'
														className='bg-neutral-100 !text-neutral-1000 font-caption w-[88px] h-7 rounded-md  font-medium text-cp-sm'
													>
														Cancel
													</button>
												</div>
											</form>
										</div>
									</div>
								</Popover.Content>
							</Popover.Portal>
						</Popover.Root>
					))}
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	)
}

export { CreatePou }
