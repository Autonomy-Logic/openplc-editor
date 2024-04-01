import { cn } from '@root/utils'
import { ComponentPropsWithoutRef } from 'react'
import {
	CloseIcon,
	LDIcon,
	SFCIcon,
	FBDIcon,
	STIcon,
	ILIcon,
} from '@oplc-icons/index'

type ITabProps = ComponentPropsWithoutRef<'div'> & {
	fileName: string
	fileLang?: 'LD' | 'SFC' | 'FBD' | 'ST' | 'IL'
	currentTab?: boolean
	handleDeleteTab: () => void
}

const LangIcon = {
	LD: <LDIcon className='w-4 h-4' />,
	SFC: <SFCIcon className='w-4 h-4' />,
	FBD: <FBDIcon className='w-4 h-4' />,
	ST: <STIcon className='w-4 h-4' />,
	IL: <ILIcon className='w-4 h-4' />,
}

const Tab = (props: ITabProps) => {
	const {
		fileName,
		fileLang = 'LD',
		currentTab,
		handleDeleteTab,
		...res
	} = props
	return (
		<div
			role='tab'
			draggable
			className={cn(
				currentTab ? '' : 'opacity-[35%] border-r border-neutral-300',
				'aria-[current=page]:dark:bg-brand-dark',
				'group cursor-pointer min-w-0 max-w-[160px] relative bg-neutral-100  h-[30px] flex-1 flex items-center justify-between overflow-hidden text-neutral-1000 dark:text-white py-2 px-3 text-start text-xs font-normal font-display dark:bg-neutral-800'
			)}
			aria-current={currentTab ? 'page' : undefined}
			{...res}
		>
			{LangIcon[fileLang]}
			<span>{fileName}</span>
			<CloseIcon
				onClick={() => handleDeleteTab()}
				className={cn('stroke-brand dark:stroke-brand-light w-4 h-4')}
			/>
			<span
				aria-hidden='true'
				className={cn(
					currentTab ? 'bg-brand' : 'bg-transparent',
					'absolute inset-x-0 top-0 h-[3px] z-50'
				)}
			/>
		</div>
	)
}

export { Tab }
