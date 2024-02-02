import { useEffect, useRef, useState } from 'react'
import { RecentIcon, StartSearchIcon } from '~renderer/assets/icons'

import { Dropdown } from '~renderer/components/elements'
import { Search } from '~renderer/features/screens/start/components/actions-bar/elements'

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
			if (
				dropdownRef.current &&
				!(dropdownRef.current as HTMLElement).contains(event.target as Node)
			) {
				setShowOptions(false)
			}
		}

		document.addEventListener('mousedown', handleClickOutside)

		return () => {
			document.removeEventListener('mousedown', handleClickOutside)
		}
	}, [])

	return (
		<div className='w-full  pr-10 xl:pr-10 3xl:pr-10 4xl:pr-0 flex mb-4 items-center gap-4 justify-between relative'>
			<Dropdown.Root ref={dropdownRef}>
				<Dropdown.Select
					className='w-60 h-full gap-3 whitespace-nowrap text-base font-caption text-neutral-700 font-normal justify-center pl-6 pr-2 relative flex items-center rounded-lg  border-neutral-100 border bg-white dark:bg-neutral-50 '
					icon={<RecentIcon />}
					selectedOption={selectedOption}
					setShowOptions={setShowOptions}
					showOptions={showOptions}
					placeholder='Order by'
				/>
				<Dropdown.Options
					className={`w-[138px]  right-0 rounded-md  bg-white border-neutral-100 border-[1.5px] absolute z-[999] top-16 ${
						showOptions ? 'block' : 'hidden'
					}`}
					options={options}
					setSelectedOption={setSelectedOption}
					setShowOptions={setShowOptions}
					selectedOption={selectedOption}
				/>
			</Dropdown.Root>
			<Search.Root className='flex flex-grow w-[704px] border-neutral-100 border-[1.5px] gap-4 px-8 rounded-lg text-base font-caption items-center h-14 bg-white dark:bg-neutral-50'>
				<StartSearchIcon />
				<Search.Input
					className='w-full h-full bg-inherit outline-none text-black'
					id='start-search'
					type='text'
					placeholder='Search a project'
				/>
			</Search.Root>
		</div>
	)
}
