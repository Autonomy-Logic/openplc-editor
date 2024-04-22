import { ProjectTreeBranch, ProjectTreeLeaf,ProjectTreeRoot } from '@components/_molecules/project-tree'
import { FolderIcon } from '@root/renderer/assets'
import { useOpenPLCStore } from '@root/renderer/store'
import { ITabProps } from '@root/renderer/store/slices'
import _ from 'lodash'

import { CreatePou } from '../../_features/[workspace]/create-pou'

const Project = () => {
  const {
    workspaceState: {
      projectData: { pous },
    },
    updateEditor,
    updateTabs,
  } = useOpenPLCStore()
  const Name = 'Project Name'

  const handleCreateTab = (tab: ITabProps) => {
    updateTabs(tab)
    updateEditor({ path: tab.name, value: tab.body })
  }

  return (
    <>
      {/* Actions handler */}
      <div id='project-actions-container' className='flex justify-around w-[200px] my-3 px-2 relative z-10'>
        <div
          id='project-name-container'
          className='flex items-center justify-start px-1.5 w-32 h-8 gap-1 rounded-lg cursor-default select-none bg-neutral-100 dark:bg-brand-dark'
        >
          <FolderIcon size='sm' />
          <span
            id='project-name'
            className='pl-1 font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-50'
          >
            {Name}
          </span>
        </div>
        <div id='create-pou-container'>
          <CreatePou />
        </div>
      </div>
      {/* Data display */}
      <ProjectTreeRoot label={Name}>
        <ProjectTreeBranch branchTarget='dataType' />
        <ProjectTreeBranch branchTarget='function'>
          {pous
            ?.filter(({ type }) => type === 'function')
            .map(({ data }) => (
              <ProjectTreeLeaf
                key={data.name}
                leafLang={data.language}
                label={data.name}
                /** Todo: Update the tab state */
                // onClick={() => handleCreateTab(data)}
              />
            ))}
        </ProjectTreeBranch>
        <ProjectTreeBranch branchTarget='functionBlock'>
          {pous
            ?.filter(({ type }) => type === 'function-block')
            .map(({ data }) => (
              <ProjectTreeLeaf
                key={data.name}
                leafLang={data.language}
                label={data.name}
                /** Todo: Update the tab state */
                // onClick={() => handleCreateTab(data)}
              />
            ))}
        </ProjectTreeBranch>
        <ProjectTreeBranch branchTarget='program'>
          {pous
            ?.filter(({ type }) => type === 'program')
            .map(({ data }) => (
              <ProjectTreeLeaf
                key={data.name}
                leafLang={data.language}
                label={data.name}
                /** Todo: Update the tab state */
                // onClick={() => handleCreateTab(data)}
              />
            ))}
        </ProjectTreeBranch>
        <ProjectTreeBranch branchTarget='device'>{/** Will be filled with device */}</ProjectTreeBranch>
        {/** Maybe a divider component */}
        {/* <ProjectTreeBranch branchTarget='' label='Resources' /> */}
      </ProjectTreeRoot>
    </>
  )
}
export { Project }
