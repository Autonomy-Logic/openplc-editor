import { createRef, useEffect, useRef, useState } from 'react'
import { Tab, TabList } from '../../_atoms'
import { useOpenPLCStore } from '@root/renderer/store'
import { IPouTemplate } from '@root/types/transfer'

const Tabs = () => {
	const { data, updateEditor } = useOpenPLCStore()
	const [selectedTab, setSelectedTab] = useState('')
	const [tabs, setTabs] = useState<IPouTemplate[]>([])
	const dndTab = useRef<number>(0)
	const replaceTab = useRef<number>(0)

	useEffect(() => {
		if (data.pous) {
			setTabs(data.pous)
		}
	}, [data])

	const handleSort = () => {
		const tabClone = [...tabs]
		const draggedTab = tabClone[dndTab.current]
		tabClone.splice(dndTab.current, 1)
		tabClone.splice(replaceTab.current, 0, draggedTab)
		setTabs(tabClone)
	}
	const handleDeleteTab = (id: number) => {
		const tabClone = [...tabs]
		tabClone.splice(id, 1)
		setTabs(tabClone)
	}
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
				<div />
			)}
		</TabList>
	)
}
export { Tabs }
