import { FolderIcon, PlusIcon } from '@root/renderer/assets'
import { useState } from 'react'

const ProjectExplorer = () => {
	const [nameIsEditing, setNameIsEditing] = useState(false)
	const Name = 'Project Name'

	return (
		<div>
			{/* Actions handler */}
			<div className='flex justify-around w-[400px] my-3 px-2'>
				<div className='flex items-center justify-start px-1.5 w-48 h-9 gap-1 rounded-lg cursor-default select-none bg-neutral-100 dark:bg-brand-dark'>
					<FolderIcon size='md' />
					<p
						data-editing={nameIsEditing}
						className='w-full pl-1 font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-50 data-[editing=true]:hidden'
					>
						{Name}
					</p>
					<input
						type='text'
						name='project-name'
						data-editing={nameIsEditing}
						value={Name}
						id='project-name'
						className='hidden w-full pl-1 py-1 rounded-sm bg-brand-medium-dark outline-none border-none drop-shadow-lg text-white font-caption font-thin text-xs transition-all data-[editing=true]:block'
					/>
					<button
						type='button'
						onClick={() => setNameIsEditing(!nameIsEditing)}
					>
						p
					</button>
				</div>
				<button
					type='button'
					className='w-10 h-8 rounded-lg bg-brand flex justify-center items-center'
				>
					<PlusIcon className='stroke-white' />
				</button>
			</div>
			{/* Data display */}
			<p>Project Explorer</p>
		</div>
	)
}
export { ProjectExplorer }
