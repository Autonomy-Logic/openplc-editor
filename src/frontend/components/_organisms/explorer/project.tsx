import { useEffect, useState } from 'react'

import { projectCapabilities } from '../../../../middleware/shared/ports/types'
import { useCapabilities, useProject } from '../../../../middleware/shared/providers'
import { canHostModbusMaster } from '../../../../middleware/shared/utils/modbus-master-profile'
import { FolderIcon } from '../../../assets/icons/interface/Folder'
import { useIsEditingLocked } from '../../../hooks/use-editing-lock'
import { useModbusMasterProfile } from '../../../hooks/use-modbus-master-profile'
import { useTargetCapabilities } from '../../../hooks/use-target-capabilities'
import { useOpenPLCStore } from '../../../store'
import type { TabsProps } from '../../../store/slices/tabs'
import { CreateEditorObjectFromTab, LIBRARY_MANIFEST_TAB_NAME } from '../../../store/slices/tabs/utils'
import { isUserManagementCapableRuntime } from '../../../utils/device'
import { isNativeScreenAvailable } from '../../../utils/native-screens'
import { useToast } from '../../_features/[app]/toast/use-toast'
import { CreatePLCElement } from '../../_features/[workspace]/create-element'
import {
  ProjectTreeBranch,
  ProjectTreeExpandableLeaf,
  ProjectTreeLeaf,
  ProjectTreeRoot,
} from '../../_molecules/project-tree'

type PouLeafLang = 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'python' | 'cpp'

const PROJECT_NAME_MIN = 2
const PROJECT_NAME_MAX = 100
const DASH_FREE_PATTERN = /^[^—–―]*$/

function validateProjectName(value: string): string | null {
  if (value.length < PROJECT_NAME_MIN || value.length > PROJECT_NAME_MAX) {
    return `Project name must be between ${PROJECT_NAME_MIN} and ${PROJECT_NAME_MAX} characters.`
  }
  if (!DASH_FREE_PATTERN.test(value)) {
    return 'Dash characters like "—" are not allowed. Use a regular hyphen "-" instead.'
  }
  return null
}

const Project = () => {
  const capabilities = useCapabilities()
  const projectPort = useProject()
  const { toast } = useToast()
  const {
    project: {
      data: { pous, dataTypes, globalVariableLists, configurations, servers, remoteDevices },
      meta: { name, type: projectType, path: projectPath },
    },
    projectActions: { updateMetaName },
    tabsActions: { updateTabs },
    editorActions: { setEditor, addModel, getEditorFromEditors, removeModel },
    workspaceActions: { setSelectedProjectTreeLeaf },
    searchQuery,
  } = useOpenPLCStore()

  const canEdit = useOpenPLCStore((s) => s.workspace.canEdit)
  const isEditingLocked = useIsEditingLocked()

  const runtimeConnected = useOpenPLCStore((s) => s.runtimeConnection.connectionStatus === 'connected')
  const runtimeVersion = useOpenPLCStore((s) => s.runtimeConnection.runtimeVersion)
  const showUserManagement = runtimeConnected && isUserManagementCapableRuntime(runtimeVersion)
  const showRuntimeStatus = runtimeConnected

  const projectCaps = projectCapabilities({ type: projectType })

  const targetCaps = useTargetCapabilities()
  const masterProfile = useModbusMasterProfile()
  const canHostRemoteIo = canHostModbusMaster(masterProfile) || targetCaps.ethercat

  const deviceBoard = useOpenPLCStore((s) => s.deviceDefinitions.configuration.deviceBoard)
  const availableBoards = useOpenPLCStore((s) => s.deviceAvailableOptions.availableBoards)
  const currentBoardInfo = availableBoards.get(deviceBoard)
  const vendorScreens = currentBoardInfo?.vpp?.screens ? Object.keys(currentBoardInfo.vpp.screens) : []

  const showPersistentStorage =
    targetCaps.nativeRetainStore && isNativeScreenAvailable(currentBoardInfo, 'persistent-storage')

  const handleCreateTab = ({ elementType, name, path, configuration: tabConfig }: TabsProps) => {
    const tabToBeCreated = { name, path, elementType, configuration: tabConfig }
    updateTabs(tabToBeCreated)

    const existing = getEditorFromEditors(tabToBeCreated.name)
    const fresh = CreateEditorObjectFromTab(tabToBeCreated)
    const existingMeta = existing === null ? null : new Map<string, unknown>(Object.entries(existing.meta))
    const stale =
      existing !== null &&
      (existing.type !== fresh.type || Object.entries(fresh.meta).some(([k, v]) => existingMeta?.get(k) !== v))
    if (stale) removeModel(tabToBeCreated.name)
    const model = existing !== null && !stale ? existing : fresh
    addModel(model)
    setEditor(model)
  }

  const [isEditing, setIsEditing] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [inputValue, setInputValue] = useState<string>(name)

  const handleBlur = async () => {
    setIsEditing(false)
    const trimmed = inputValue.trim()

    if (trimmed === name) {
      setInputValue(name)
      return
    }

    const validationError = validateProjectName(trimmed)
    if (validationError) {
      toast({ title: 'Invalid project name', description: validationError, variant: 'warn' })
      setInputValue(name)
      return
    }

    setIsRenaming(true)
    const result = await projectPort.renameProject(projectPath, trimmed)
    setIsRenaming(false)

    if (!result.success) {
      toast({
        title: 'Failed to rename project',
        description: result.error ?? 'The project could not be renamed.',
        variant: 'fail',
      })
      setInputValue(name)
      return
    }

    updateMetaName(result.name ?? trimmed)
  }

  useEffect(() => {
    setInputValue(name)
  }, [name])

  return (
    <div id='project-container' className='flex h-full w-full flex-col pr-2'>
      <div id='project-actions-container' className='relative z-10 my-3 flex w-full justify-normal gap-2 pl-2'>
        <div
          id='project-name-container'
          className='flex h-8 w-full flex-1 cursor-default select-none items-center justify-start gap-1 rounded-lg bg-neutral-100 px-1.5 py-[1px] dark:bg-brand-dark'
          onClick={() => {
            if (canEdit && !isRenaming && !isEditingLocked) setIsEditing(true)
          }}
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
                onBlur={() => void handleBlur()}
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

      <div id='project-tree-container' className='mb-1 flex h-full w-full flex-col overflow-auto'>
        <ProjectTreeRoot label={name}>
          {projectCaps.hasLibraryManifest && (
            <ProjectTreeLeaf
              leafLang='libraryManifest'
              leafType='library-manifest'
              label={LIBRARY_MANIFEST_TAB_NAME}
              onClick={() =>
                handleCreateTab({
                  name: LIBRARY_MANIFEST_TAB_NAME,
                  path: '/library.json',
                  elementType: { type: 'library-manifest' },
                })
              }
            />
          )}

          <ProjectTreeBranch branchTarget='function'>
            {pous
              ?.filter((pou) => pou.pouType === 'function')
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((pou) => (
                <ProjectTreeLeaf
                  key={pou.name}
                  leafLang={pou.body.language as PouLeafLang}
                  leafType='function'
                  label={pou.name}
                  highlightQuery={searchQuery}
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

          <ProjectTreeBranch branchTarget='function-block'>
            {pous
              ?.filter((pou) => pou.pouType === 'function-block')
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((pou) => (
                <ProjectTreeLeaf
                  key={pou.name}
                  leafLang={pou.body.language as PouLeafLang}
                  leafType='function-block'
                  label={pou.name}
                  highlightQuery={searchQuery}
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

          {projectCaps.hasPrograms && (
            <ProjectTreeBranch branchTarget='program'>
              {pous
                ?.filter((pou) => pou.pouType === 'program')
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((pou) => (
                  <ProjectTreeLeaf
                    key={pou.name}
                    leafLang={pou.body.language as PouLeafLang}
                    leafType='program'
                    label={pou.name}
                    highlightQuery={searchQuery}
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
          )}

          <ProjectTreeBranch branchTarget='data-type'>
            {dataTypes
              ?.filter(({ derivation }) => derivation === 'array')
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(({ name }) => (
                <ProjectTreeLeaf
                  key={name}
                  leafLang='arr'
                  leafType='data-type'
                  label={name}
                  highlightQuery={searchQuery}
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
                  label={name}
                  highlightQuery={searchQuery}
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
                  label={name}
                  highlightQuery={searchQuery}
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

          <ProjectTreeBranch branchTarget='global-variable-list'>
            {globalVariableLists
              ?.slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(({ name }) => (
                <ProjectTreeLeaf
                  key={name}
                  leafLang='gvl'
                  leafType='global-variable-list'
                  label={name}
                  highlightQuery={searchQuery}
                  onClick={() =>
                    handleCreateTab({
                      name,
                      path: `/data/global-variables/${name}`,
                      elementType: { type: 'global-variable-list' },
                    })
                  }
                />
              ))}
          </ProjectTreeBranch>

          {projectCaps.hasResource && (
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
          )}

          {projectCaps.hasDevices && (
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
                  label='Edge Devices'
                  onClick={() =>
                    handleCreateTab({
                      name: 'Edge Devices',
                      path: `/device/orchestrators`,
                      elementType: { type: 'device', derivation: 'orchestrators' },
                    })
                  }
                />
              )}
              {showRuntimeStatus && (
                <ProjectTreeLeaf
                  key='Runtime Status'
                  leafLang='devConfig'
                  leafType='device'
                  label='Runtime Status'
                  onClick={() =>
                    handleCreateTab({
                      name: 'Runtime Status',
                      path: `/device/runtime-status`,
                      elementType: { type: 'device', derivation: 'runtime-status' },
                    })
                  }
                />
              )}
              {showPersistentStorage && (
                <ProjectTreeLeaf
                  key='Persistent Storage'
                  leafLang='persistentStorage'
                  leafType='persistent-storage'
                  label='Persistent Storage'
                  onClick={() =>
                    handleCreateTab({
                      name: 'Persistent Storage',
                      path: `/device/persistent-storage`,
                      elementType: { type: 'persistent-storage' },
                    })
                  }
                />
              )}
              {showUserManagement && (
                <ProjectTreeLeaf
                  key='User Management'
                  leafLang='userManagement'
                  leafType='user-management'
                  label='User Management'
                  onClick={() =>
                    handleCreateTab({
                      name: 'User Management',
                      path: `/device/user-management`,
                      elementType: { type: 'user-management' },
                    })
                  }
                />
              )}
              {projectCaps.hasVendorScreens &&
                vendorScreens.map((screenName) => (
                  <ProjectTreeLeaf
                    key={`vendor-${screenName}`}
                    leafLang='vendorScreen'
                    leafType='vendor-screen'
                    label={screenName}
                    onClick={() =>
                      handleCreateTab({
                        name: screenName,
                        path: `/vendor-screen/${screenName}`,
                        elementType: { type: 'vendor-screen', screenName },
                      })
                    }
                  />
                ))}
            </ProjectTreeBranch>
          )}

          {projectCaps.hasServers && (
            <ProjectTreeBranch branchTarget='server'>
              {[...(servers || [])]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((server) => (
                  <ProjectTreeLeaf
                    key={server.name}
                    leafLang='server'
                    leafType='server'
                    label={server.name}
                    highlightQuery={searchQuery}
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
          )}

          {projectCaps.hasRemoteDevices && (canHostRemoteIo || (remoteDevices?.length ?? 0) > 0) && (
            <ProjectTreeBranch branchTarget='remote-device'>
              {[...(remoteDevices || [])]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((device) =>
                  device.protocol === 'ethercat' ? (
                    <ProjectTreeExpandableLeaf
                      key={device.name}
                      leafLang='remoteDevice'
                      leafType='remote-device'
                      label={device.name}
                      highlightQuery={searchQuery}
                      onClick={() =>
                        handleCreateTab({
                          name: device.name,
                          path: `/devices/remote/${device.name}.json`,
                          elementType: { type: 'remote-device', protocol: device.protocol },
                        })
                      }
                    >
                      {device.ethercatConfig?.devices?.map((child) => {
                        const isModular = child.isModularCoupler === true || (child.modules?.length ?? 0) > 0
                        if (isModular) {
                          return (
                            <ProjectTreeExpandableLeaf
                              key={child.id}
                              leafLang='ethercatDevice'
                              leafType='ethercat-device'
                              label={child.name}
                              highlightQuery={searchQuery}
                              onClick={() =>
                                handleCreateTab({
                                  name: child.name,
                                  path: `/devices/remote/${device.name}/devices/${child.id}`,
                                  elementType: { type: 'ethercat-device', busName: device.name, deviceId: child.id },
                                })
                              }
                            >
                              {(child.modules ?? [])
                                .slice()
                                .sort((a, b) => a.slot - b.slot)
                                .map((module) => (
                                  <ProjectTreeLeaf
                                    key={module.id}
                                    leafLang='ethercatDevice'
                                    leafType='ethercat-module'
                                    busName={device.name}
                                    deviceId={child.id}
                                    moduleId={module.id}
                                    label={`Slot ${module.slot} — ${module.name}`}
                                    highlightQuery={searchQuery}
                                    onClick={() =>
                                      handleCreateTab({
                                        name: `${child.name}/${module.name}`,
                                        path: `/devices/remote/${device.name}/devices/${child.id}/modules/${module.id}`,
                                        elementType: {
                                          type: 'ethercat-module',
                                          busName: device.name,
                                          deviceId: child.id,
                                          moduleId: module.id,
                                        },
                                      })
                                    }
                                  />
                                ))}
                            </ProjectTreeExpandableLeaf>
                          )
                        }
                        return (
                          <ProjectTreeLeaf
                            key={child.id}
                            leafLang={child.cia402?.enabled ? 'softMotionDrive' : 'ethercatDevice'}
                            leafType='ethercat-device'
                            busName={device.name}
                            deviceId={child.id}
                            label={child.name}
                            highlightQuery={searchQuery}
                            onClick={() =>
                              handleCreateTab({
                                name: child.name,
                                path: `/devices/remote/${device.name}/devices/${child.id}`,
                                elementType: { type: 'ethercat-device', busName: device.name, deviceId: child.id },
                              })
                            }
                          />
                        )
                      })}
                    </ProjectTreeExpandableLeaf>
                  ) : (
                    <ProjectTreeLeaf
                      key={device.name}
                      leafLang='remoteDevice'
                      leafType='remote-device'
                      label={device.name}
                      highlightQuery={searchQuery}
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
          )}
        </ProjectTreeRoot>
      </div>
    </div>
  )
}

export { Project }
