import { useRef } from 'react'
import { Tab, TabList } from '../../_atoms'
import { useOpenPLCStore } from '@root/renderer/store'

const TabsNavigation = () => {
	const { data, updateEditor } = useOpenPLCStore()
	const dragTab = useRef<number>(0)
	const draggedOverTab = useRef<number>(0)
	return (
		<TabList>
			{data?.pous.map((pou) => (
				<Tab
					key={pou.name}
					fileName={pou.name}
					fileLang={pou.language}
					currentTab
				/>
			))}
		</TabList>
	)
}
export { TabsNavigation }
