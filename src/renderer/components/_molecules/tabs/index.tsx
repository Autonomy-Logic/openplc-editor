import { createRef, useEffect, useRef, useState } from 'react'
import { Tab, TabList } from '../../_atoms'
import { useOpenPLCStore } from '@root/renderer/store'
import { IPouTemplate } from '@root/types/transfer'

const Tabs = () => {
	const {
		data,
		updateTabs,
		setTabs,
		tabsState: { tabs },
		updateEditor,
	} = useOpenPLCStore()
	const [selectedTab, setSelectedTab] = useState('')
	const dndTab = useRef<number>(0)
	const replaceTab = useRef<number>(0)
	const handleSort = () => {
		const tabClone = [...tabs]
		const draggedTab = tabClone[dndTab.current]
		tabClone.splice(dndTab.current, 1)
		tabClone.splice(replaceTab.current, 0, draggedTab)
		updateTabs(tabClone)
	}
	const handleDeleteTab = (id: number) => {
		const tabClone = [...tabs]
		tabClone.splice(id, 1)
		updateTabs(tabClone)
	}
	/**
	 * Todo: this tab handler should be refactored to fit all possibles cases
	 * @param tab the selected tab
	 */
	const handleClickedTab = (tab: IPouTemplate) => {
		setSelectedTab(tab.name)
		updateEditor({ path: tab.name, value: tab.body })
	}

	const handleDragStart = ({
		tab,
		idx,
	}: { tab: IPouTemplate; idx: number }) => {
		dndTab.current = idx
		setSelectedTab(tab.name)
	}
	const handleDragEnter = (idx: number) => {
		replaceTab.current = idx
	}
	return (
		<TabList>
			{tabs.length > 0 ? (
				tabs.map((pou, idx) => (
					<Tab
						onDragStart={() => handleDragStart({ tab: pou, idx })}
						onDragEnter={() => handleDragEnter(idx)}
						onDragEnd={() => handleSort()}
						onDragOver={(e) => e.preventDefault()}
						onClick={() => handleClickedTab(pou)}
						handleDeleteTab={() => handleDeleteTab(idx)}
						key={pou.name}
						fileName={pou.name}
						fileLang={pou.language}
						currentTab={selectedTab === pou.name}
					/>
				))
			) : (
				<div className='h-[35px] bg-inherit border-none' />
			)}
		</TabList>
	)
}
export { Tabs }
