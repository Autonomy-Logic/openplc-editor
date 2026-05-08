import { useEffect, useState } from 'react'

import { useCapabilities } from '../../../../middleware/shared/providers'
import { FolderIcon } from '../../../assets/icons/interface/Folder'
import { useOpenPLCStore } from '../../../store'
import { extractSearchQuery } from '../../../store/slices/search/utils'
import type { TabsProps } from '../../../store/slices/tabs'
import { CreateEditorObjectFromTab } from '../../../store/slices/tabs/utils'
import { CreatePLCElement } from '../../_features/[workspace]/create-element'
import {
  ProjectTreeBranch,
  ProjectTreeExpandableLeaf,
  ProjectTreeLeaf,
  ProjectTreeRoot,
} from '../../_molecules/project-tree'

type PouLeafLang = 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'python' | 'cpp'

const Project = () => {
  const capabilities = useCapabilities()
  const {
    project: {
      data: { pous, dataTypes, configurations, servers, remoteDevices },
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
              ?.filter((pou) => pou.pouType === 'function')
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((pou) => (
                <ProjectTreeLeaf
                  key={pou.name}
                  leafLang={pou.body.language as PouLeafLang}
                  leafType='function'
                  label={searchQuery ? extractSearchQuery(pou.name, searchQuery) : pou.name}
                  onClick={() =>
                    handleCreateTab({
                      name: pou.name,
                      path: `/data/pous/function/${pou.name}`,
                      elementType: { type: 'function', language: pou.body.language as PouLeafLang },
                    })
                  }
                />
              ))}
          </ProjectTreeBranch>

          {/* Project Function Blocks tree branch */}
          <ProjectTreeBranch branchTarget='function-block'>
            {pous
              ?.filter((pou) => pou.pouType === 'function-block')
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((pou) => (
                <ProjectTreeLeaf
                  key={pou.name}
                  leafLang={pou.body.language as PouLeafLang}
                  leafType='function-block'
                  label={searchQuery ? extractSearchQuery(pou.name, searchQuery) : pou.name}
                  onClick={() =>
                    handleCreateTab({
                      name: pou.name,
                      path: `/data/pous/function-block/${pou.name}`,
                      elementType: { type: 'function-block', language: pou.body.language as PouLeafLang },
                    })
                  }
                />
              ))}
          </ProjectTreeBranch>

          {/* Project Programs tree branch */}
          <ProjectTreeBranch branchTarget='program'>
            {pous
              ?.filter((pou) => pou.pouType === 'program')
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((pou) => (
                <ProjectTreeLeaf
                  key={pou.name}
                  leafLang={pou.body.language as PouLeafLang}
                  leafType='program'
                  label={searchQuery ? extractSearchQuery(pou.name, searchQuery) : pou.name}
                  onClick={() =>
                    handleCreateTab({
                      name: pou.name,
                      path: `/data/pous/program/${pou.name}`,
                      elementType: { type: 'program', language: pou.body.language as PouLeafLang },
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
                configuration: configurations,
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
            {capabilities.hasLocalSerialPorts && (
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
            )}
            {capabilities.hasOrchestratorDevices && (
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
            )}
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
              .map((device) =>
                device.protocol === 'ethercat' ? (
                  <ProjectTreeExpandableLeaf
                    key={device.name}
                    leafLang='remoteDevice'
                    leafType='remote-device'
                    label={searchQuery ? extractSearchQuery(device.name, searchQuery) : device.name}
                    onClick={() =>
                      handleCreateTab({
                        name: device.name,
                        path: `/devices/remote/${device.name}.json`,
                        elementType: { type: 'remote-device', protocol: device.protocol },
                      })
                    }
                  >
                    {device.ethercatConfig?.devices?.map((child) => (
                      <ProjectTreeLeaf
                        key={child.id}
                        leafLang='ethercatDevice'
                        leafType='ethercat-device'
                        busName={device.name}
                        deviceId={child.id}
                        label={searchQuery ? extractSearchQuery(child.name, searchQuery) : child.name}
                        onClick={() =>
                          handleCreateTab({
                            name: child.name,
                            path: `/devices/remote/${device.name}/devices/${child.id}`,
                            elementType: { type: 'ethercat-device', busName: device.name, deviceId: child.id },
                          })
                        }
                      />
                    ))}
                  </ProjectTreeExpandableLeaf>
                ) : (
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
                ),
              )}
          </ProjectTreeBranch>
        </ProjectTreeRoot>
      </div>
    </div>
  )
}

export { Project }
