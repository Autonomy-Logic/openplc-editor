import {
	ArrowIcon,
	CExtIcon,
	DataTypeIcon,
	FBDIcon,
	FolderIcon,
	FunctionBlockIcon,
	FunctionIcon,
	ILIcon,
	LDIcon,
	PlusIcon,
	ProgramIcon,
	ResourceIcon,
	SFCIcon,
	STIcon,
} from '@root/renderer/assets'
import * as Popover from '@radix-ui/react-popover'
import SecundaryPopover from './secundaryPopover'

const Name = 'Project Name'
export default function ProjectActions() {
	return (
		<Popover.Root>
			<div className='flex justify-around w-[200px] my-3 px-2 relative z-10'>
				<div className='flex items-center justify-start px-1.5 w-32 h-8 gap-1 rounded-lg cursor-default select-none bg-neutral-100 dark:bg-brand-dark'>
					<FolderIcon size='sm' />
					<span className='pl-1 font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-50'>
						{Name}
					</span>
				</div>
				<Popover.Trigger
					type='button'
					className='w-10 h-8 rounded-lg bg-brand flex justify-center items-center'
				>
					<PlusIcon className='stroke-white' />
				</Popover.Trigger>
				<Popover.Content alignOffset={-7} sideOffset={10} align='end'>
					<div className='w-[188px] h-fit drop-shadow-lg border border-brand-light dark:border-brand-medium-dark bg-white dark:bg-neutral-950 p-2 rounded-lg flex flex-col gap-2'>
						<SecundaryPopover />
					</div>
				</Popover.Content>
			</div>
		</Popover.Root>
	)
}
