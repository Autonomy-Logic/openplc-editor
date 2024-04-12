import {
	ArrowIcon,
	CExtIcon,
	DataTypeIcon,
	FBDIcon,
	FolderIcon,
	FunctionBlockIcon,
	FunctionIcon,
	ILIcon,
	LDIcon,
	PlusIcon,
	ProgramIcon,
	ResourceIcon,
	SFCIcon,
	STIcon,
} from '@root/renderer/assets'
import {
	ProjectTreeRoot,
	ProjectTreeBranch,
	ProjectTreeLeaf,
} from '@components/_molecules/project-tree'
import { useOpenPLCStore } from '@root/renderer/store'
import { IPouTemplate } from '@root/types/transfer'
import * as Popover from '@radix-ui/react-popover'
import * as Select from '@radix-ui/react-select'
import { useState } from 'react'
import ProjectActions from './projectActions'

const ProjectExplorer = () => {
	const {
		data: { pous },
		updateEditor,
		updateTabs,
	} = useOpenPLCStore()
	const Name = 'Project Name'

	const handleCreateTab = (tab: IPouTemplate) => {
		updateTabs(tab)
		updateEditor({ path: tab.name, value: tab.body })
	}

	return (
		<>
			{/* Actions handler */}
			<ProjectActions />
			{/* Data display */}
			{/* Work in progress: Do not change the structure */}
			<ProjectTreeRoot label={Name}>
				<ProjectTreeBranch branchTarget='dataType' />
				<ProjectTreeBranch branchTarget='function'>
					{pous
						?.filter((pou) => pou.type === 'function')
						.map((pou) => (
							<ProjectTreeLeaf
								key={pou.name}
								leafLang={pou.language}
								label={pou.name}
								onClick={() => handleCreateTab(pou)}
							/>
						))}
				</ProjectTreeBranch>
				<ProjectTreeBranch branchTarget='functionBlock'>
					{pous
						?.filter((pou) => pou.type === 'functionBlock')
						.map((pou) => (
							<ProjectTreeLeaf
								key={pou.name}
								leafLang={pou.language}
								label={pou.name}
								onClick={() => handleCreateTab(pou)}
							/>
						))}
				</ProjectTreeBranch>
				<ProjectTreeBranch branchTarget='program'>
					{pous
						?.filter((pou) => pou.type === 'program')
						.map((pou) => (
							<ProjectTreeLeaf
								key={pou.name}
								leafLang={pou.language}
								label={pou.name}
								onClick={() => handleCreateTab(pou)}
							/>
						))}
				</ProjectTreeBranch>
				<ProjectTreeBranch branchTarget='device'>
					{/** Will be filled with device */}
				</ProjectTreeBranch>
				{/** Maybe a divider component */}
				{/* <ProjectTreeBranch branchTarget='' label='Resources' /> */}
			</ProjectTreeRoot>
		</>
	)
}
export { ProjectExplorer }
