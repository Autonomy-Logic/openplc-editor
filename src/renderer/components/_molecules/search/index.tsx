import { ComponentPropsWithoutRef, createRef } from 'react'
import { InputWithRef } from '../../_atoms/input'
import { MagnifierIcon } from '@root/renderer/assets'

type ISearchProps = ComponentPropsWithoutRef<'form'>
const Search = (props: ISearchProps) => {
	const inputRef = createRef<HTMLInputElement>()
	return (
		<form
			className='flex flex-grow w-[704px] mr-2 xl:mr-4 border-neutral-100 border-[1.5px] gap-4 px-8 rounded-lg text-base font-caption items-center h-14 bg-white dark:bg-neutral-50'
			{...props}
		>
			<MagnifierIcon className='stroke-brand cursor-default' />
			<InputWithRef
				className='w-full h-full bg-inherit outline-none text-black'
				ref={inputRef}
				id='start-search'
				type='text'
				placeholder='Search a project'
			/>
		</form>
	)
}

export { Search }
