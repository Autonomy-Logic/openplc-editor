import { ComponentPropsWithoutRef, ReactNode } from 'react'
import { useForm, SubmitHandler, Controller } from 'react-hook-form'
import {
	FunctionBlockIcon,
	FunctionIcon,
	ProgramIcon,
	FBDIcon,
	ILIcon,
	LDIcon,
	SFCIcon,
	STIcon,
} from '@root/renderer/assets'
import { InputWithRef } from '../../_atoms'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from '../../_atoms/select'
import { kebabCase, camelCase } from 'lodash'
import { useOpenPLCStore } from '@root/renderer/store'
import { IFunction, IFunctionBlock, IProgram } from '@root/types/PLC'
import { z } from 'zod'

type IPouCardProps = ComponentPropsWithoutRef<'div'>
const PouCard = (props: IPouCardProps) => (
	<div
		id='pou-card-root'
		className='flex flex-col drop-shadow-lg pb-3 px-3 pt-2 gap-3 w-[225px] h-fit border border-brand-light dark:border-brand-medium-dark bg-white dark:bg-neutral-950 p-2 rounded-lg'
		{...props}
	/>
)

type IPouCardLabelProps = ComponentPropsWithoutRef<'div'> & {
	type: 'function' | 'function-block' | 'program'
}

const PouCardLabelSources = {
	function: {
		icon: <FunctionIcon size='md' />,
		label: 'Function',
	},
	'function-block': {
		icon: <FunctionBlockIcon size='md' />,
		label: 'Function Block',
	},
	program: {
		icon: <ProgramIcon size='md' />,
		label: 'Program',
	},
}
const PouCardLabel = (props: IPouCardLabelProps) => {
	const { type, ...res } = props
	return (
		<div
			id='pou-card-label-container'
			className='flex items-center w-full h-8 flex-col justify-between'
			{...res}
		>
			<div className='flex w-full items-center gap-2'>
				{PouCardLabelSources[type].icon}
				<p className='text-start font-caption text-xs font-normal text-neutral-1000 dark:text-neutral-300 flex-1 my-[2px]'>
					{PouCardLabelSources[type].label}
				</p>
			</div>
			<div className='bg-neutral-200 dark:!bg-neutral-850 h-[1px] w-full' />
		</div>
	)
}

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
type IPouCardFormProps = ComponentPropsWithoutRef<'form'> & {
	type: 'function' | 'function-block' | 'program'
}

const PouCardForm = ({ type, ...res }: IPouCardFormProps) => {
	const { control, register, handleSubmit } = useForm<PouProps>()
	const { actions } = useOpenPLCStore()

	const convertToInitial = (str: string) => {
		const draft = str.split('-')
		const initial = draft.map((word) => word.charAt(0).toUpperCase()).join('')
		return initial
	}

	/** Todo: add a function to create a pou in the app store */
	const onSubmit: SubmitHandler<PouProps> = (data) => {
		actions.createPou({
			type: 'program',
			data: {
				name: data['pou-name'],
				language: convertToInitial(data['pou-language']) as
					| 'LD'
					| 'SFC'
					| 'FBD'
					| 'ST'
					| 'IL',
			},
		})
	}
	return (
		<form
			onSubmit={handleSubmit(onSubmit)}
			className='flex flex-col pb-3 pt-2 gap-3 w-full h-fit'
			{...res}
		>
			<input type='hidden' {...register('pou-type')} value={type} />
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
												value={kebabCase(lang.value)}
											>
												<span className='flex items-center  font-caption text-cp-sm gap-2 text-neutral-850 dark:text-neutral-300 font-medium'>
													{lang.icon} <span>{lang.value}</span>
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
			<div id='form-button-container' className='w-full flex justify-between'>
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
	)
}

export { PouCard, PouCardLabel, PouCardForm }
