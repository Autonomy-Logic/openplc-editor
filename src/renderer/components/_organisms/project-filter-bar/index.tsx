import * as PrimitiveDropdown from '@radix-ui/react-dropdown-menu'
import { ArrowIcon, MagnifierIcon } from '@root/renderer/assets'
import { ReactNode, useState } from 'react'

import { InputWithRef } from '../../_atoms'

const ProjectFilterBar = (): ReactNode => {
  const [projectFilter, setProjectFilter] = useState('Recent')
  return (
    <div
      id='project-filter-bar'
      className='w-full pr-10 xl:pr-10 3xl:pr-10 4xl:pr-0 flex mb-4 items-center gap-4 justify-between relative'
    >
      <div
        id='project-filter-dropdown-container'
        className='flex select-none relative min-w-52 h-12 shrink-0 items-center justify-around pl-4 py-[6px] gap-3 rounded-md border border-neutral-100 dark:border-neutral-800 bg-white dark:bg-neutral-900'
      >
        <div id='project-filter-dropdown-label'>
          <span className='cursor-default text-base font-caption font-normal text-neutral-700 dark:text-neutral-500 whitespace-nowrap'>
            Order by
          </span>
        </div>
        <PrimitiveDropdown.Root>
          <PrimitiveDropdown.Trigger asChild>
            <button
              id='project-filter-dropdown-button'
              type='button'
              className='group flex flex-1 w-full max-w-28 h-full rounded-md items-center justify-around'
            >
              <span className='text-base font-caption font-normal text-black dark:text-white whitespace-nowrap'>
                {projectFilter}
              </span>
              <ArrowIcon
                size='md'
                variant='primary'
                direction='down'
                className='stroke-brand inline transition-all group-data-[state=open]:rotate-90'
              />
            </button>
          </PrimitiveDropdown.Trigger>
          <PrimitiveDropdown.Content
            id='project-filter-dropdown-options'
            sideOffset={15}
            className='w-[--radix-dropdown-menu-trigger-width] rounded-md bg-white dark:bg-neutral-900              
              border border-neutral-100 dark:border-neutral-800 
              [&_[role=menuitem]:first-child]:rounded-t-md [&_[role=menuitem]:last-child]:rounded-b-md
              *:flex *:flex-col *:justify-center *:align-start *:pl-2 *:w-full *:h-9
              *:text-black *:dark:text-white *:text-base *:font-caption *:font-normal
              '
          >
            <PrimitiveDropdown.Item
              id='project-filter-dropdown-item-recent'
              aria-selected={projectFilter === 'Recent'}
              onSelect={() => setProjectFilter('Recent')}
              className='bg-white hover:cursor-pointer aria-selected:bg-neutral-100 hover:bg-neutral-50 dark:bg-neutral-900 dark:aria-selected:bg-neutral-800 hover:dark:bg-neutral-700 select-none outline-none'
            >
              <span>Recent</span>
            </PrimitiveDropdown.Item>
            <PrimitiveDropdown.Item
              id='project-filter-dropdown-item-name'
              aria-selected={projectFilter === 'Name'}
              onSelect={() => setProjectFilter('Name')}
              className='bg-white hover:cursor-pointer aria-selected:bg-neutral-100 hover:bg-neutral-50 dark:bg-neutral-900 dark:aria-selected:bg-neutral-800 hover:dark:bg-neutral-700 select-none outline-none'
            >
              <span>Name</span>
            </PrimitiveDropdown.Item>
            <PrimitiveDropdown.Item
              id='project-filter-dropdown-item-size'
              aria-selected={projectFilter === 'Size'}
              onSelect={() => setProjectFilter('Size')}
              className='bg-white hover:cursor-pointer aria-selected:bg-neutral-100 hover:bg-neutral-50 dark:bg-neutral-900 dark:aria-selected:bg-neutral-800 hover:dark:bg-neutral-700 select-none outline-none'
            >
              <span>Size</span>
            </PrimitiveDropdown.Item>
          </PrimitiveDropdown.Content>
        </PrimitiveDropdown.Root>
      </div>
      <div
        id='project-filter-search-container'
        className='flex flex-grow w-[704px] mr-2 xl:mr-4 border-neutral-100 dark:border-neutral-800 border-[1.5px] gap-4 px-8 rounded-lg text-base font-caption items-center h-12 bg-white dark:bg-neutral-900'
      >
        <div id='project-filter-search-label'>
          <MagnifierIcon className='stroke-brand cursor-default' />
        </div>
        <InputWithRef
          id='project-filter-search-input'
          type='text'
          placeholder='Search for a project'
          className='w-full h-full bg-inherit outline-none text-black dark:text-white placeholder:font-caption placeholder:font-normal'
        />
      </div>
    </div>
  )
}

export { ProjectFilterBar }
