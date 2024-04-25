import { Dropdown } from '@components/elements'
import { Search } from '@features/screens/start/components/actions-bar/elements'
import { ArrowIcon, MagnifierIcon } from '@process:renderer/assets/icons'
import { useEffect, useRef, useState } from 'react'

export default function ActionsBar() {
  const options = [
    {
      label: 'Recent',
      onClick: () => {
        console.log('option 1 clicked')
      },
    },
    {
      label: 'Size',
      onClick: () => {
        console.log('option 2 clicked')
      },
    },
    {
      label: 'Name',
      onClick: () => {
        console.log('option 3 clicked')
      },
    },
  ]
  const [selectedOption, setSelectedOption] = useState(options[0].label)
  const [showOptions, setShowOptions] = useState<boolean>(false)
  const dropdownRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !(dropdownRef.current as HTMLElement).contains(event.target as Node)) {
        setShowOptions(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  return (
    <div className='relative mb-4 flex w-full items-center justify-between gap-4 pr-10 xl:pr-10 3xl:pr-10 4xl:pr-0'>
      <Dropdown.Root ref={dropdownRef}>
        <Dropdown.Select
          className='relative flex h-full w-60 items-center justify-center gap-3 whitespace-nowrap rounded-lg border border-neutral-100 bg-white pl-6 pr-2 font-caption  text-base font-normal text-neutral-700 dark:bg-neutral-50 '
          Icon={ArrowIcon}
          selectedOption={selectedOption}
          setShowOptions={setShowOptions}
          showOptions={showOptions}
          placeholder='Order by'
        />
        <Dropdown.Options
          className={`absolute right-0 top-16 z-[999] w-[138px] rounded-md border-[1.5px] border-neutral-100 bg-white ${
            showOptions ? 'block' : 'hidden'
          }`}
          options={options}
          setSelectedOption={setSelectedOption}
          setShowOptions={setShowOptions}
          selectedOption={selectedOption}
        />
      </Dropdown.Root>
      <Search.Root className='mr-2 flex h-14 w-[704px] flex-grow items-center gap-4 rounded-lg border-[1.5px] border-neutral-100 bg-white px-8 font-caption text-base xl:mr-4 dark:bg-neutral-50'>
        <MagnifierIcon className='cursor-default stroke-brand' />
        <Search.Input
          className='h-full w-full bg-inherit text-black outline-none'
          id='start-search'
          type='text'
          placeholder='Search a project'
        />
      </Search.Root>
    </div>
  )
}
