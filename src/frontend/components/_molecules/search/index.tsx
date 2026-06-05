import { ComponentPropsWithoutRef, createRef } from 'react'

import { MagnifierIcon } from '../../../assets/icons/interface/Magnifier'
import { InputWithRef } from '../../_atoms/input'

type ISearchProps = ComponentPropsWithoutRef<'form'>
const Search = (props: ISearchProps) => {
  const inputRef = createRef<HTMLInputElement>()
  return (
    <form
      className='mr-2 flex h-14 w-[704px] flex-grow items-center gap-4 rounded-lg border-[1.5px] border-neutral-100 bg-white px-8 font-caption text-base dark:bg-neutral-50 xl:mr-4'
      {...props}
    >
      <MagnifierIcon className='cursor-default stroke-brand' />
      <InputWithRef
        className='h-full w-full bg-inherit text-black outline-none'
        ref={inputRef}
        id='start-search'
        type='text'
        placeholder='Search a project'
      />
    </form>
  )
}

export { Search }
