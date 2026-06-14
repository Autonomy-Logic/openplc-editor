import { useEffect, useState } from 'react'

import { projectCapabilities } from '../../../../middleware/shared/ports/types'
import { useCapabilities, useProject } from '../../../../middleware/shared/providers'
import { FolderIcon } from '../../../assets/icons/interface/Folder'
import { useOpenPLCStore } from '../../../store'
import { extractSearchQuery } from '../../../store/slices/search/utils'
import type { TabsProps } from '../../../store/slices/tabs'
import { CreateEditorObjectFromTab, LIBRARY_MANIFEST_TAB_NAME } from '../../../store/slices/tabs/utils'
import { useToast } from '../../_features/[app]/toast/use-toast'
import { CreatePLCElement } from '../../_features/[workspace]/create-element'
import {
  ProjectTreeBranch,
  ProjectTreeExpandableLeaf,
  ProjectTreeLeaf,
  ProjectTreeRoot,
} from '../../_molecules/project-tree'

type PouLeafLang = 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'python' | 'cpp'

// Mirror the backend's RenameProjectDto rules so we can reject obviously
// invalid names before the round-trip and give immediate feedback. The
// backend (`project-input.constants.ts`) is still the source of truth — long
// dashes break git refs / S3 paths handled by the git-worker.
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
      data: { pous, dataTypes, configurations, servers, remoteDevices },
      meta: { name, type: projectType, path: projectPath },
    },
    projectActions: { updateMetaName },
    tabsActions: { updateTabs },
    editorActions: { setEditor, addModel, getEditorFromEditors },
    workspaceActions: { setSelectedProjectTreeLeaf },
    searchQuery,
  } = useOpenPLCStore()

  // Read-only / forked projects can't be renamed — the backend rename
  // endpoint requires edit access, so gate the affordance here too.
  const canEdit = useOpenPLCStore((s) => s.workspace.canEdit)

  // Per-project-type capability matrix — drives which branches
  // render.  Library projects only show Functions / Function Blocks /
  // Data Types plus the manifest tab; Programs / Resource / Devices /
  // Servers / Remote-Devices / VPP screens are program-level
  // affordances that don't apply to a `.stlib` build.
  const projectCaps = projectCapabilities({ type: projectType })

  // Get VPP vendor screens from the currently selected board
  const deviceBoard = useOpenPLCStore((s) => s.deviceDefinitions.configuration.deviceBoard)
  const availableBoards = useOpenPLCStore((s) => s.deviceAvailableOptions.availableBoards)
  const currentBoardInfo = availableBoards.get(deviceBoard)
  const vendorScreens = currentBoardInfo?.vpp?.screens ? Object.keys(currentBoardInfo.vpp.screens) : []

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
  const [isRenaming, setIsRenaming] = useState(false)
  const [inputValue, setInputValue] = useState<string>(name)

  const handleBlur = async () => {
    setIsEditing(false)
    const trimmed = inputValue.trim()

    // No-op when unchanged — reset the field to drop any stray whitespace.
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

    // Persist the rename to the backend FIRST (it updates the canonical DB
    // name, moves the S3 folder and realigns gitPath). Only mirror it into
    // the in-memory meta.name on success, so a rejected rename never leaves
    // the UI showing a name the backend didn't accept.
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
      {/* Actions handler */}
      <div id='project-actions-container' className='relative z-10 my-3 flex w-full justify-normal gap-2 pl-2'>
        {/* Project name input */}
        <div
          id='project-name-container'
          className='flex h-8 w-full flex-1 cursor-default select-none items-center justify-start gap-1 rounded-lg bg-neutral-100 px-1.5 py-[1px] dark:bg-brand-dark'
          onClick={() => {
            if (canEdit && !isRenaming) setIsEditing(true)
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

      {/* Data display */}
      <div id='project-tree-container' className='mb-1 flex h-full w-full flex-col overflow-auto'>
        <ProjectTreeRoot label={name}>
          {/* Library Project manifest leaf — single fixed entry at
              the top of the tree, opens `library.json` in a Monaco
              JSON editor.  Cannot be deleted or renamed (the file
              is mandatory for `.stlib` builds).  Only rendered for
              library projects. */}
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

          {/* Project Programs tree branch — hidden in library projects
              (libraries have no programs). */}
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
          )}

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

          {/* Project Resources tree branch — hidden for libraries. */}
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

          {/* Project Device tree branch — hidden for libraries. */}
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
          )}

          {/* Vendor screens from VPP packages — hidden for libraries. */}
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

          {/* Project Servers tree branch — gated by project type only.
           *  The Servers branch must remain visible on platforms that
           *  lack local serial ports (e.g. orchestrator-only / web
           *  builds), per the fix in d257e2a07; libraries still hide
           *  it via the `projectCaps.hasServers` capability check. */}
          {projectCaps.hasServers && (
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
          )}

          {/* Project Remote Devices tree branch — hidden for libraries. */}
          {projectCaps.hasRemoteDevices && (
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
          )}
        </ProjectTreeRoot>
      </div>
    </div>
  )
}

export { Project }
