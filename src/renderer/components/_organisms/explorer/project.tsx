import { ProjectTreeBranch, ProjectTreeLeaf, ProjectTreeRoot } from '@components/_molecules/project-tree'
import { FolderIcon } from '@root/renderer/assets'
import { useOpenPLCStore } from '@root/renderer/store'
import { ITabProps } from '@root/renderer/store/slices'
import { CreateEditorObject } from '@root/renderer/store/slices/shared/utils'

import { CreatePou } from '../../_features/[workspace]/create-pou'

const Project = () => {
  const {
    projectData: { pous, dataTypes },
    tabsActions: { updateTabs },
    editorActions: { setEditor },
  } = useOpenPLCStore()
  const Name = 'Project Name'

  const handleCreateTab = (
    type: 'program' | 'function' | 'function-block',
    name: string,
    language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd',
  ) => {
    const tabToBeCreated: ITabProps = {
      type,
      name,
      language,
    }
    updateTabs(tabToBeCreated)
    setEditor(CreateEditorObject(tabToBeCreated))
  }

  return (
    <div className='max-w-[184px]'>
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
        <ProjectTreeBranch branchTarget='data-type'>
          <ProjectTreeBranch branchTarget='array' isSubBranch>
            {dataTypes
              ?.filter(({ derivation }) => derivation.type === 'array')
              .map(({ id, name }) => (
                <ProjectTreeLeaf
                  key={id}
                  leafLang='dt'
                  label={name}
                  /** Todo: Update the tab state */
                  // onClick={() => handleCreateTab('array', data.name, data.language)}
                />
              ))}
          </ProjectTreeBranch>
          <ProjectTreeBranch branchTarget='enum' isSubBranch>
            {dataTypes
              ?.filter(({ derivation }) => derivation.type === 'enumerated')
              .map(({ id, name }) => (
                <ProjectTreeLeaf
                  key={id}
                  leafLang='dt'
                  label={name}
                  /** Todo: Update the tab state */
                  // onClick={() => handleCreateTab('enum', data.name, data.language)}
                />
              ))}
          </ProjectTreeBranch>
          <ProjectTreeBranch branchTarget='structure' isSubBranch>
            {dataTypes
              ?.filter(({ derivation }) => derivation.type === 'structure')
              .map(({ id, name }) => (
                <ProjectTreeLeaf
                  key={id}
                  leafLang='dt'
                  label={name}
                  /** Todo: Update the tab state */
                  // onClick={() => handleCreateTab('structure', data.name, data.language)}
                />
              ))}
          </ProjectTreeBranch>
        </ProjectTreeBranch>
        <ProjectTreeBranch branchTarget='function'>
          {pous
            ?.filter(({ type }) => type === 'function')
            .map(({ data }) => (
              <ProjectTreeLeaf
                key={data.name}
                leafLang={data.language}
                label={data.name}
                /** Todo: Update the tab state */
                onClick={() => handleCreateTab('function', data.name, data.language)}
              />
            ))}
        </ProjectTreeBranch>
        <ProjectTreeBranch branchTarget='function-block'>
          {pous
            ?.filter(({ type }) => type === 'function-block')
            .map(({ data }) => (
              <ProjectTreeLeaf
                key={data.name}
                leafLang={data.language}
                label={data.name}
                /** Todo: Update the tab state */
                onClick={() => handleCreateTab('function-block', data.name, data.language)}
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
                onClick={() => handleCreateTab('program', data.name, data.language)}
              />
            ))}
        </ProjectTreeBranch>
        <ProjectTreeBranch branchTarget='device'>{/** Will be filled with device */}</ProjectTreeBranch>
        {/** Maybe a divider component */}
        {/* <ProjectTreeBranch branchTarget='' label='Resources' /> */}
      </ProjectTreeRoot>
    </div>
  )
}
export { Project }
