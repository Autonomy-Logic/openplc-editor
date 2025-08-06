import { ProjectTreeBranch, ProjectTreeLeaf, ProjectTreeRoot } from '@components/_molecules/project-tree'
import { FolderIcon } from '@root/renderer/assets'
import { useOpenPLCStore } from '@root/renderer/store'
import { TabsProps } from '@root/renderer/store/slices'
import { extractSearchQuery } from '@root/renderer/store/slices/search/utils'
import { useEffect, useState } from 'react'

import { CreatePLCElement } from '../../_features/[workspace]/create-element'

const Project = () => {
  const {
    searchQuery,
    project: {
      data: { pous, dataTypes, configuration },
      meta: { name },
    },
    projectActions: { updateMetaName },
    sharedWorkspaceActions: { openFile },
    workspaceActions: { setSelectedProjectTreeLeaf },
  } = useOpenPLCStore()
  const [isEditing, setIsEditing] = useState(false)
  const [inputValue, setInputValue] = useState<string>(name)

  const handleCreateTab = (data: TabsProps) => {
    openFile(data)
  }

  const handleBlur = () => {
    setIsEditing(false)
    if (inputValue !== name) {
      updateMetaName(inputValue)
    }
  }

  useEffect(() => {
    setInputValue(name)
  }, [name])

  return (
    <div id='project-container' className='flex h-full w-full flex-col pr-2'>
      {/* Actions handler */}
      <div id='project-actions-container' className='relative z-10 my-3 flex w-full justify-normal gap-2 pl-2'>
        {/* Project name input */}
        <div
          id='project-name-container'
          className='flex h-8 w-full flex-1 cursor-default select-none items-center justify-start gap-1 rounded-lg bg-neutral-100 px-1.5 py-[1px] dark:bg-brand-dark'
          onClick={() => setIsEditing(true)}
        >
          <div className='flex-shrink-0'>
            <FolderIcon size='sm' className='h-5 w-5' style={{ minWidth: '16px', minHeight: '16px' }} />
          </div>
          {isEditing ? (
            <div className='h-5.5 flex w-full items-center border-none bg-transparent px-0 py-0'>
              <input
                id='project-name'
                className={`box-border h-full w-full cursor-text bg-transparent px-2 py-0 text-xs font-medium text-neutral-1000 outline-none dark:text-neutral-50`}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value as unknown as string)}
                onBlur={handleBlur}
                autoFocus
              />
            </div>
          ) : (
            <span
              id='project-name'
              className={`w-full cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap rounded-lg px-2 py-1 text-xs font-medium text-neutral-1000 dark:text-neutral-50`}
              title='Edit name project'
            >
              {name}
            </span>
          )}
        </div>
        <div id='create-plc-container'>
          <CreatePLCElement />
        </div>
      </div>

      {/* Data display */}
      <div id='project-tree-container' className='mb-1 flex h-full w-full flex-col overflow-auto'>
        <ProjectTreeRoot label={name}>
          {/* Project Functions tree branch */}
          <ProjectTreeBranch branchTarget='function'>
            {pous
              ?.filter(({ type }) => type === 'function')
              .map(({ data }) => (
                <ProjectTreeLeaf
                  key={data.name}
                  leafLang={data.language}
                  leafType='function'
                  label={searchQuery ? extractSearchQuery(data.name, searchQuery) : data.name}
                  onClick={() =>
                    handleCreateTab({
                      name: data.name,
                      path: `/pous/functions/${data.name}.json`,
                      elementType: { type: 'function', language: data.language },
                    })
                  }
                />
              ))}
          </ProjectTreeBranch>

          {/* Project Function Blocks tree branch */}
          <ProjectTreeBranch branchTarget='function-block'>
            {pous
              ?.filter(({ type }) => type === 'function-block')
              .map(({ data }) => (
                <ProjectTreeLeaf
                  key={data.name}
                  leafLang={data.language}
                  leafType='function-block'
                  label={searchQuery ? extractSearchQuery(data.name, searchQuery) : data.name}
                  onClick={() =>
                    handleCreateTab({
                      name: data.name,
                      path: `/pous/function-blocks/${data.name}.json`,
                      elementType: { type: 'function-block', language: data.language },
                    })
                  }
                />
              ))}
          </ProjectTreeBranch>

          {/* Project Programs tree branch */}
          <ProjectTreeBranch branchTarget='program'>
            {pous
              ?.filter(({ type }) => type === 'program')
              .map(({ data }) => (
                <ProjectTreeLeaf
                  key={data.name}
                  leafLang={data.language}
                  leafType='program'
                  label={searchQuery ? extractSearchQuery(data.name, searchQuery) : data.name}
                  onClick={() =>
                    handleCreateTab({
                      name: data.name,
                      path: `/pous/programs/${data.name}.json`,
                      elementType: { type: 'program', language: data.language },
                    })
                  }
                />
              ))}
          </ProjectTreeBranch>

          {/* Project Data Types tree branch */}
          <ProjectTreeBranch branchTarget='data-type'>
            {dataTypes
              ?.filter(({ derivation }) => derivation === 'array')
              .map(({ name }) => (
                <ProjectTreeLeaf
                  nested={true}
                  key={name}
                  leafLang='arr'
                  leafType='data-type'
                  label={searchQuery ? extractSearchQuery(name, searchQuery) : name}
                  onClick={() =>
                    handleCreateTab({
                      name,
                      path: `/project.json`,
                      elementType: { type: 'data-type', derivation: 'array' },
                    })
                  }
                />
              ))}
            {dataTypes
              ?.filter(({ derivation }) => derivation === 'enumerated')
              .map(({ name }) => (
                <ProjectTreeLeaf
                  nested={true}
                  key={name}
                  leafLang='enum'
                  leafType='data-type'
                  label={searchQuery ? extractSearchQuery(name, searchQuery) : name}
                  /** Todo: Update the tab state */
                  onClick={() =>
                    handleCreateTab({
                      name,
                      path: `/project.json`,
                      elementType: { type: 'data-type', derivation: 'enumerated' },
                    })
                  }
                />
              ))}
            {dataTypes
              ?.filter(({ derivation }) => derivation === 'structure')
              .map(({ name }) => (
                <ProjectTreeLeaf
                  nested={true}
                  key={name}
                  leafLang='str'
                  leafType='data-type'
                  label={searchQuery ? extractSearchQuery(name, searchQuery) : name}
                  /** Todo: Update the tab state */
                  onClick={() =>
                    handleCreateTab({
                      name,
                      path: `/project.json`,
                      elementType: { type: 'data-type', derivation: 'structure' },
                    })
                  }
                />
              ))}
          </ProjectTreeBranch>

          {/* Project Resources tree branch */}
          <ProjectTreeBranch
            branchTarget='resource'
            onClick={() => {
              handleCreateTab({
                configuration: configuration,
                name: 'Resource',
                path: `/project.json`,
                elementType: { type: 'resource' },
              })
              setSelectedProjectTreeLeaf({
                label: 'Resource',
                type: 'resource',
              })
            }}
          />

          {/* Project Device tree branch */}
          <ProjectTreeBranch branchTarget='device'>
            <ProjectTreeLeaf
              key='Configuration'
              leafLang='devConfig'
              leafType='device'
              label='Configuration'
              /** Todo: Update the tab state */
              onClick={() =>
                handleCreateTab({
                  name: 'Configuration',
                  path: `/device`,
                  elementType: { type: 'device', derivation: 'configuration' },
                })
              }
            />
          </ProjectTreeBranch>
        </ProjectTreeRoot>
      </div>
    </div>
  )
}

export { Project }
