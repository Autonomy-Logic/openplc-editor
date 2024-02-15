import { FolderIcon } from '../../../assets'

export const Header = () => {
	return (
		<div className='flex justify-around w-full mb-3 px-2 '>
			<h2 className='flex items-center justify-around px-1.5 w-32 h-8 rounded-lg cursor-default select-none bg-neutral-100 dark:bg-brand-dark'>
				<FolderIcon />
				<span className='font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-50'>
					Project Name
				</span>
			</h2>
			<button
				type='button'
				className='w-10 h-8 rounded-lg bg-brand text-4xl text-neutral-50 font-light relative'
			>
				<span className='absolute bottom-0 left-2'>+</span>
			</button>
		</div>
	)
}
