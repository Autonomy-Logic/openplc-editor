import { ProjectTreeBranch, ProjectTreeLeaf, ProjectTreeRoot } from '../../_molecules/project-tree'
import { FolderIcon } from '../../../assets/icons/interface/Folder'
import { useOpenPLCStore } from '../../../store'
import type { TabsProps } from '../../../store/slices/tabs'
import { CreateEditorObjectFromTab } from '../../../store/slices/tabs/utils'
import { extractSearchQuery } from '../../../store/slices/search/utils'
import { useEffect, useState } from 'react'

import { CreatePLCElement } from '../../_features/[workspace]/create-element'

const Project = () => {
  const {
    project: {
      data: { pous, dataTypes, configuration, servers, remoteDevices },
      meta: { name },
    },
    projectActions: { updateMetaName },
    tabsActions: { updateTabs },
    editorActions: { setEditor, addModel, getEditorFromEditors },
    workspaceActions: { setSelectedProjectTreeLeaf },
    searchQuery,
  } = useOpenPLCStore()

  const handleCreateTab = ({ elementType, name, path, configuration: tabConfig }: TabsProps) => {
    const tabToBeCreated = { name, path, elementType, configuration: tabConfig }
    updateTabs(tabToBeCreated)

    const editor = getEditorFromEditors(tabToBeCreated.name)
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
              .sort((a, b) => a.data.name.localeCompare(b.data.name))
              .map(({ data }) => (
                <ProjectTreeLeaf
                  key={data.name}
                  leafLang={data.language}
                  leafType='function'
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

          {/* Project Function Blocks tree branch */}
          <ProjectTreeBranch branchTarget='function-block'>
            {pous
              ?.filter(({ type }) => type === 'function-block')
              .sort((a, b) => a.data.name.localeCompare(b.data.name))
              .map(({ data }) => (
                <ProjectTreeLeaf
                  key={data.name}
                  leafLang={data.language}
                  leafType='function-block'
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

          {/* Project Programs tree branch */}
          <ProjectTreeBranch branchTarget='program'>
            {pous
              ?.filter(({ type }) => type === 'program')
              .sort((a, b) => a.data.name.localeCompare(b.data.name))
              .map(({ data }) => (
                <ProjectTreeLeaf
                  key={data.name}
                  leafLang={data.language}
                  leafType='program'
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

          {/* Project Data Types tree branch */}
          <ProjectTreeBranch branchTarget='data-type'>
            {dataTypes
              ?.filter(({ derivation }) => derivation === 'array')
              .sort((a, b) => a.name.localeCompare(b.name))
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
                      path: `/data/data-types/array/${name}`,
                      elementType: { type: 'data-type', derivation: 'array' },
                    })
                  }
                />
              ))}
            {dataTypes
              ?.filter(({ derivation }) => derivation === 'enumerated')
              .sort((a, b) => a.name.localeCompare(b.name))
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
                      path: `/data/data-types/enumerated/${name}`,
                      elementType: { type: 'data-type', derivation: 'enumerated' },
                    })
                  }
                />
              ))}
            {dataTypes
              ?.filter(({ derivation }) => derivation === 'structure')
              .sort((a, b) => a.name.localeCompare(b.name))
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
                      path: `/data/data-types/structure/${name}`,
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
                path: `/data/configuration/resource`,
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
              onClick={() =>
                handleCreateTab({
                  name: 'Configuration',
                  path: `/device/configuration`,
                  elementType: { type: 'device', derivation: 'configuration' },
                })
              }
            />
            <ProjectTreeLeaf
              leafLang='devOrchestrators'
              leafType='device'
              label='Orchestrators'
              onClick={() =>
                handleCreateTab({
                  name: 'Orchestrators',
                  path: `/device/orchestrators`,
                  elementType: { type: 'device', derivation: 'orchestrators' },
                })
              }
            />
          </ProjectTreeBranch>

          {/* Project Servers tree branch */}
          <ProjectTreeBranch branchTarget='server'>
            {[...(servers || [])]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((server) => (
                <ProjectTreeLeaf
                  key={server.name}
                  leafLang='server'
                  leafType='server'
                  label={searchQuery ? extractSearchQuery(server.name, searchQuery) : server.name}
                  onClick={() =>
                    handleCreateTab({
                      name: server.name,
                      path: `/servers/${server.name}`,
                      elementType: { type: 'server', protocol: server.protocol },
                    })
                  }
                />
              ))}
          </ProjectTreeBranch>

          {/* Project Remote Devices tree branch */}
          <ProjectTreeBranch branchTarget='remote-device'>
            {[...(remoteDevices || [])]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((device) => (
                <ProjectTreeLeaf
                  key={device.name}
                  leafLang='remoteDevice'
                  leafType='remote-device'
                  label={searchQuery ? extractSearchQuery(device.name, searchQuery) : device.name}
                  onClick={() =>
                    handleCreateTab({
                      name: device.name,
                      path: `/device/remote/${device.name}`,
                      elementType: { type: 'remote-device', protocol: device.protocol },
                    })
                  }
                />
              ))}
          </ProjectTreeBranch>
        </ProjectTreeRoot>
      </div>
    </div>
  )
}

export { Project }
