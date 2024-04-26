import { ProjectTreeBranch, ProjectTreeLeaf, ProjectTreeRoot } from '@components/_molecules/project-tree'
import { FolderIcon } from '@root/renderer/assets'
import { useOpenPLCStore } from '@root/renderer/store'
import { ITabProps } from '@root/renderer/store/slices'

import { CreatePou } from '../../_features/[workspace]/create-pou'

const Project = () => {
  const {
    workspaceState: {
      projectData: { pous },
    },
    tabsActions: { updateTabs },
    // updateEditor,
  } = useOpenPLCStore()
  const Name = 'Project Name'

  const handleCreateTab = (name: string, language: 'IL' | 'ST' | 'LD' | 'SFC' | 'FBD') => {
    const tabToBeCreated: ITabProps = {
      name,
      language,
      currentTab: true,
    }
    updateTabs(tabToBeCreated)
  }

  return (
    <>
      {/* Actions handler */}
      <div id='project-actions-container' className='relative z-10 my-3 flex w-[200px] justify-around px-2'>
        <div
          id='project-name-container'
          className='flex h-8 w-32 cursor-default select-none items-center justify-start gap-1 rounded-lg bg-neutral-100 px-1.5 dark:bg-brand-dark'
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
                onClick={() => handleCreateTab(data.name, data.language)}
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
                onClick={() => handleCreateTab(data.name, data.language)}
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
                onClick={() => handleCreateTab(data.name, data.language)}
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
