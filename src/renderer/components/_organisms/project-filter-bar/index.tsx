import * as PrimitiveDropdown from '@radix-ui/react-dropdown-menu'
import { ArrowIcon, MagnifierIcon } from '@root/renderer/assets'
import { ReactNode, useState } from 'react'

import { InputWithRef } from '../../_atoms'

interface ProjectFilterBarProps { setFilterValueProps: (projectFilterValue: string) => void; }

const ProjectFilterBar: React.FC<ProjectFilterBarProps> = ({setFilterValueProps}): ReactNode => {
  const [projectFilter, setProjectFilter] = useState('Recent')
  return (
    <div
      id='project-filter-bar'
      className='relative mb-4 flex w-full items-center justify-between gap-4 pr-10 xl:pr-10 3xl:pr-10 4xl:pr-0'
    >
      <div
        id='project-filter-dropdown-container'
        className='relative flex h-12 min-w-52 shrink-0 select-none items-center justify-around gap-3 rounded-md border border-neutral-100 bg-white py-[6px] pl-4 dark:border-neutral-800 dark:bg-neutral-900'
      >
        <div id='project-filter-dropdown-label'>
          <span className='cursor-default whitespace-nowrap font-caption text-base font-normal text-neutral-700 dark:text-neutral-500'>
            Order by
          </span>
        </div>
        <PrimitiveDropdown.Root>
          <PrimitiveDropdown.Trigger asChild>
            <button
              id='project-filter-dropdown-button'
              type='button'
              className='group flex h-full w-full max-w-28 flex-1 items-center justify-around rounded-md'
            >
              <span className='whitespace-nowrap font-caption text-base font-normal text-black dark:text-white'>
                {projectFilter}
              </span>
              <ArrowIcon
                size='md'
                variant='primary'
                direction='down'
                className='inline stroke-brand transition-all group-data-[state=open]:rotate-90'
              />
            </button>
          </PrimitiveDropdown.Trigger>
          <PrimitiveDropdown.Content
            id='project-filter-dropdown-options'
            sideOffset={15}
            className='*:align-start w-[--radix-dropdown-menu-trigger-width] rounded-md border
              border-neutral-100 bg-white *:flex
              *:h-9 *:w-full
              *:flex-col *:justify-center *:pl-2 *:font-caption *:text-base *:font-normal *:text-black
              dark:border-neutral-800 dark:bg-neutral-900 *:dark:text-white [&_[role=menuitem]:first-child]:rounded-t-md [&_[role=menuitem]:last-child]:rounded-b-md
              '
          >
            <PrimitiveDropdown.Item
              id='project-filter-dropdown-item-recent'
              aria-selected={projectFilter === 'Recent'}
              onSelect={() => {setProjectFilter('Recent');  setFilterValueProps('Recent')}} 
              className='select-none bg-white outline-none hover:cursor-pointer hover:bg-neutral-50 aria-selected:bg-neutral-100 dark:bg-neutral-900 hover:dark:bg-neutral-700 dark:aria-selected:bg-neutral-800'
            >
              <span>Recent</span>
            </PrimitiveDropdown.Item>
            <PrimitiveDropdown.Item
              id='project-filter-dropdown-item-name'
              aria-selected={projectFilter === 'Name'}
              onSelect={() => {setProjectFilter('Name');  setFilterValueProps('Name')}}
              className='select-none bg-white outline-none hover:cursor-pointer hover:bg-neutral-50 aria-selected:bg-neutral-100 dark:bg-neutral-900 hover:dark:bg-neutral-700 dark:aria-selected:bg-neutral-800'
            >
              <span>Name</span>
            </PrimitiveDropdown.Item>
            <PrimitiveDropdown.Item
              id='project-filter-dropdown-item-size'
              aria-selected={projectFilter === 'Size'}
              onSelect={() => {setProjectFilter('Size') ; setFilterValueProps('Size')} }
              className='select-none bg-white outline-none hover:cursor-pointer hover:bg-neutral-50 aria-selected:bg-neutral-100 dark:bg-neutral-900 hover:dark:bg-neutral-700 dark:aria-selected:bg-neutral-800'
            >
              <span>Size</span>
            </PrimitiveDropdown.Item>
          </PrimitiveDropdown.Content>
        </PrimitiveDropdown.Root>
      </div>
      <div
        id='project-filter-search-container'
        className='mr-2 flex h-12 w-[704px] flex-grow items-center gap-4 rounded-lg border-[1.5px] border-neutral-100 bg-white px-8 font-caption text-base xl:mr-4 dark:border-neutral-800 dark:bg-neutral-900'
      >
        <div id='project-filter-search-label'>
          <MagnifierIcon className='cursor-default stroke-brand' />
        </div>
        <InputWithRef
          id='project-filter-search-input'
          type='text'
          placeholder='Search for a project'
          className='h-full w-full bg-inherit text-black outline-none placeholder:select-none placeholder:font-caption placeholder:font-normal dark:text-white'
        />
      </div>
    </div>
  )
}

export { ProjectFilterBar }
