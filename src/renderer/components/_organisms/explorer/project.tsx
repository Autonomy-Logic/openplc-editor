import { ProjectTreeBranch, ProjectTreeLeaf, ProjectTreeRoot } from '@components/_molecules/project-tree'
import { FolderIcon } from '@root/renderer/assets'
import { useOpenPLCStore } from '@root/renderer/store'
import { TabsProps } from '@root/renderer/store/slices'
import { CreateEditorObjectFromTab } from '@root/renderer/store/slices/tabs/utils'
import React, { useEffect, useState } from 'react'

import { CreatePLCElement } from '../../_features/[workspace]/create-element'

const Project = () => {
  const {
    project: {
      data: { pous, dataTypes, configuration },
      meta: {name}
    },
    projectActions: { updateMetaName },
    tabsActions: { updateTabs },
    editorActions: { setEditor, addModel, getEditorFromEditors },
    searchActions: { extractSearchQuery },
    searchQuery,
  } = useOpenPLCStore()
  const handleCreateTab = ({ elementType, name, path }: TabsProps) => {
    const tabToBeCreated = { name, path, elementType }
    updateTabs(tabToBeCreated)

    const editor = getEditorFromEditors(tabToBeCreated.name)
    console.log(editor)
    if (!editor) {
      const model = CreateEditorObjectFromTab(tabToBeCreated)
      addModel(model)
      setEditor(model)
      return
    }
    addModel(editor)
    setEditor(editor)
  }

  const [isEditing, setIsEditing] = useState(false)
  const [inputValue, setInputValue] = useState<string>(name)

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
          <ProjectTreeBranch branchTarget='function'>
            {pous
              ?.filter(({ type }) => type === 'function')
              .map(({ data }) => (
                <ProjectTreeLeaf
                  key={data.name}
                  leafLang={data.language}
                  label={searchQuery ? extractSearchQuery(data.name, searchQuery) : data.name}
                  onClick={() =>
                    handleCreateTab({
                      name: data.name,
                      path: `/data/pous/function/${data.name}`,
                      elementType: { type: 'function', language: data.language },
                    })
                  }
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
                  label={searchQuery ? extractSearchQuery(data.name, searchQuery) : data.name}
                  onClick={() =>
                    handleCreateTab({
                      name: data.name,
                      path: `/data/pous/function-block/${data.name}`,
                      elementType: { type: 'function-block', language: data.language },
                    })
                  }
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
                  label={searchQuery ? extractSearchQuery(data.name, searchQuery) : data.name}
                  onClick={() =>
                    handleCreateTab({
                      name: data.name,
                      path: `/data/pous/program/${data.name}`,
                      elementType: { type: 'program', language: data.language },
                    })
                  }
                />
              ))}
          </ProjectTreeBranch>

          <ProjectTreeBranch branchTarget='data-type'>
            {dataTypes
              ?.filter(({ derivation }) => derivation === 'array')
              .map(({ name }) => (
                <ProjectTreeLeaf
                  nested
                  key={name}
                  leafLang='arr'
                  label={searchQuery ? extractSearchQuery(name, searchQuery) : name}
                  onClick={() =>
                    handleCreateTab({
                      name,
                      path: `/data/data-types/array/${name}`,
                      elementType: { type: 'data-type', derivation: 'array' },
                    })
                  }
                />
              ))}
            {dataTypes
              ?.filter(({ derivation }) => derivation === 'enumerated')
              .map(({  name }) => (
                <ProjectTreeLeaf
                  nested
                  key={name}
                  leafLang='enum'
                  label={searchQuery ? extractSearchQuery(name, searchQuery) : name}
                  /** Todo: Update the tab state */
                  onClick={() =>
                    handleCreateTab({
                      name,
                      path: `/data/data-types/enumerated/${name}`,
                      elementType: { type: 'data-type', derivation: 'enumerated' },
                    })
                  }
                />
              ))}
            {dataTypes
              ?.filter(({ derivation }) => derivation === 'structure')
              .map(({ name }) => (
                <ProjectTreeLeaf
                  nested
                  key={name}
                  leafLang='str'
                  label={searchQuery ? extractSearchQuery(name, searchQuery) : name}
                  /** Todo: Update the tab state */
                  onClick={() =>
                    handleCreateTab({
                      name,
                      path: `/data/data-types/structure/${name}`,
                      elementType: { type: 'data-type', derivation: 'structure' },
                    })
                  }
                />
              ))}
          </ProjectTreeBranch>

          <ProjectTreeBranch
            branchTarget='resource'
            onClick={() =>
              handleCreateTab({
                configuration: configuration,
                name: 'resource',
                path: `/data/configuration/resource`,
                elementType: { type: 'resource' },
              })
            }
          />
          <ProjectTreeBranch branchTarget='device'>{/** Will be filled with device */}</ProjectTreeBranch>
          {/** Maybe a divider component */}
          {/* <ProjectTreeBranch branchTarget='' label='Resources' /> */}
        </ProjectTreeRoot>
      </div>
    </div>
  )
}

export { Project }
