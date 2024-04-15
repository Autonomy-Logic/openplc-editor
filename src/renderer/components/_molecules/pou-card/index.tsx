import {
	FunctionBlockIcon,
	FunctionIcon,
	ProgramIcon,
} from '@root/renderer/assets'
import { ComponentPropsWithoutRef } from 'react'
import { InputWithRef } from '../../_atoms'
import ProjectSelect from '../../_organisms/explorer/projectActions/select'
import {
	Select,
	SelectValue,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from '../../_atoms/select'

type IPouCardProps = ComponentPropsWithoutRef<'div'>
const PouCard = (props: IPouCardProps) => (
	<div
		id='pou-card-root'
		className='flex flex-col drop-shadow-lg pb-3 px-3 pt-2 gap-3 w-[225px] h-fit border border-brand-light dark:border-brand-medium-dark bg-white dark:bg-neutral-950 p-2 rounded-lg'
		{...props}
	/>
)

type IPouCardLabelProps = ComponentPropsWithoutRef<'div'> & {
	pouType: 'function' | 'function-block' | 'program'
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
	const { pouType, ...res } = props
	return (
		<div
			id='pou-card-label-container'
			className='flex items-center w-full h-8 flex-col justify-between'
			{...res}
		>
			<div className='flex w-full items-center gap-2'>
				{PouCardLabelSources[pouType].icon}
				<p className='text-start font-caption text-xs font-normal text-neutral-1000 dark:text-neutral-300 flex-1 my-[2px]'>
					{PouCardLabelSources[pouType].label}
				</p>
			</div>
			<div className='bg-neutral-200 dark:!bg-neutral-850 h-[1px] w-full' />
		</div>
	)
}

type IPouCardFormProps = ComponentPropsWithoutRef<'div'>
const PouCardForm = (props: IPouCardFormProps) => {
	return (
		<form className='flex flex-col pb-3 pt-2 gap-3 w-full h-fit'>
			<div
				id='pou-name-form-container'
				className='flex flex-col w-full gap-[6px] '
			>
				<p
					id='pou-name-label'
					className='text-start font-caption text-xs font-normal text-neutral-1000 dark:text-neutral-300 flex-1 my-[2px]'
				>
					POU name:
				</p>
				<InputWithRef
					type='text'
					placeholder='POU name'
					className='px-2 w-full dark:text-neutral-300  outline-none border border-neutral-100 dark:border-brand-medium-dark text-neutral-850 font-medium text-cp-sm bg-white dark:bg-neutral-950 py-2 h-[30px] rounded-md'
				/>
			</div>
			<div
				id='pou-language-form-container'
				className='flex flex-col w-full gap-[6px] '
			>
				<p
					id='pou-language-label'
					className='text-start font-caption text-xs font-normal text-neutral-1000 dark:text-neutral-300 flex-1 my-[2px]'
				>
					Language:
				</p>
				<Select>
					<SelectTrigger
						className='h-[30px] px-2 py-1 flex items-center w-full outline-none border border-neutral-100 dark:border-brand-medium-dark font-medium text-cp-sm bg-white dark:bg-neutral-950 rounded-md'
						aria-label='pou-language'
					>
						<SelectValue placeholder='Select a language' />
					</SelectTrigger>
					<SelectContent className='dark:bg-neutral-950 w-[--radix-select-trigger-width] drop-shadow-lg overflow-hidden border h-fit bg-white border-neutral-100 dark:border-brand-medium-dark rounded-lg'>
						<SelectItem value='Select a language' />
						<SelectItem value='Python' />
					</SelectContent>
				</Select>
			</div>
			<div id='form-button-container' className='w-full flex justify-between'>
				<button
					type='button'
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
