import * as PrimitiveDropdown from '@radix-ui/react-dropdown-menu'
import { useEffect, useState } from 'react'

import { useCapabilities, useDevice, useProject, useSystem, useWindow } from '../../middleware/shared/providers'
import { DocumentationIcon } from '../assets/icons/interface/Documentation'
import { FolderIcon } from '../assets/icons/interface/Folder'
import { PlusIcon } from '../assets/icons/interface/Plus'
import { StickArrowIcon } from '../assets/icons/interface/StickArrow'
import { StartAccountSection } from '../components/_features/[start]/account'
import { StartCloudProjects } from '../components/_features/[start]/cloud-projects'
import { MenuDivider, MenuItem, MenuRoot, MenuSection } from '../components/_features/[start]/menu'
import { OpenCloudProjectModal } from '../components/_features/[start]/open-cloud-project'
import DisplayRecentProjects from '../components/_organisms/display-recent-projects'
import { ProjectFilterBar, type ProjectOrder } from '../components/_organisms/project-filter-bar'
import { StartMainContent } from '../components/_templates/[start]/main-content'
import { StartSideContent } from '../components/_templates/[start]/side-content'
import { useOpenPLCStore } from '../store'

/** Public docs on Autonomy Edge; the same page for every environment, so not derived from the API URL. */
const DOCUMENTATION_URL = 'https://edge.autonomylogic.com/docs'

const StartScreen = () => {
  const [searchFilterValue, setSearchFilterProps] = useState<string>('')
  // Held here because the bar orders both lists below it, not just the local one.
  const [orderBy, setOrderBy] = useState<ProjectOrder>('Recent')
  const [openCloudOpen, setOpenCloudOpen] = useState(false)
  // Bumped when the Edge account changes, so the sibling cloud list re-reads.
  const [cloudRevision, setCloudRevision] = useState(0)
  const capabilities = useCapabilities()
  const system = useSystem()
  const projectPort = useProject()
  const device = useDevice()
  const windowPort = useWindow()

  const {
    workspaceActions: { setRecent },
    modalActions: { openModal },
    deviceActions: { setAvailableOptions },
    sharedWorkspaceActions: { handleOpenProjectResponse },
  } = useOpenPLCStore()

  // Both reads are optional on the port: a build without a cloud channel keeps Open local-only.
  const canOpenFromCloud =
    capabilities.hasEdgeAccount &&
    projectPort.listCloudFolders !== undefined &&
    projectPort.listCloudProjectsInFolder !== undefined

  const handleCreateProject = () => {
    openModal('create-project', null)
  }

  const handleOpenProject = async () => {
    const result = await projectPort.openProject()
    if (result.success && result.data) {
      handleOpenProjectResponse(result.data)
    }
  }

  const searchFilter = (value: string) => {
    setSearchFilterProps(value)
  }

  const handleExitAppRequest = () => {
    windowPort.requestQuit()
  }

  const handleOpenDocumentation = () => {
    void system.openExternalLink(DOCUMENTATION_URL)
  }

  useEffect(() => {
    const loadRecent = async () => {
      const recentProjects = await projectPort.getRecentProjects()
      setRecent(recentProjects)
    }
    void loadRecent()
  }, [projectPort, setRecent])

  // Load available communication ports (editor-only, harmless no-op on web)
  useEffect(() => {
    let isMounted = true

    const loadPorts = async () => {
      const ports = await device.getCommunicationPorts()
      if (isMounted) {
        setAvailableOptions({ availableCommunicationPorts: ports })
      }
    }
    void loadPorts()

    return () => {
      isMounted = false
    }
  }, [device, setAvailableOptions])

  if (!capabilities.hasLocalFilesystem) {
    return (
      <div className='flex h-full w-full items-center justify-center bg-neutral-950'>
        <div className='flex flex-col items-center gap-6 text-center'>
          <div className='flex flex-col items-center gap-2'>
            <h1 className='text-2xl font-semibold text-neutral-100'>Welcome to OpenPLC Editor</h1>
            <p className='max-w-md text-neutral-400'>
              No project is currently loaded. Please provide a project ID in the URL to load a project.
            </p>
          </div>
          <div className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'>
            <p className='text-sm text-neutral-500'>
              Example: <code className='text-brand'>?project_id=your-project-id</code>
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <StartSideContent>
        <MenuRoot>
          <MenuSection id='1'>
            <MenuItem onClick={() => handleCreateProject()}>
              <PlusIcon className='stroke-white' /> New Project
            </MenuItem>
            <PrimitiveDropdown.Root>
              {/* `Button` does not forward a ref, and Radix anchors the menu on the ref; the div is that anchor. */}
              <PrimitiveDropdown.Trigger asChild>
                <div className='w-fit'>
                  <MenuItem ghosted>
                    <FolderIcon /> Open
                  </MenuItem>
                </div>
              </PrimitiveDropdown.Trigger>
              <PrimitiveDropdown.Content
                side='right'
                align='start'
                sideOffset={8}
                className='z-[10] min-w-60 rounded-md border border-neutral-100 bg-white p-1 font-caption text-base text-black shadow-lg dark:border-neutral-800 dark:bg-neutral-900 dark:text-white'
              >
                <PrimitiveDropdown.Item
                  onSelect={() => void handleOpenProject()}
                  className='cursor-pointer select-none rounded px-3 py-2 outline-none hover:bg-neutral-50 focus:bg-neutral-100 dark:hover:bg-neutral-800 dark:focus:bg-neutral-800'
                >
                  Local project…
                </PrimitiveDropdown.Item>
                <PrimitiveDropdown.Item
                  disabled={!canOpenFromCloud}
                  onSelect={() => setOpenCloudOpen(true)}
                  className='cursor-pointer select-none rounded px-3 py-2 outline-none hover:bg-neutral-50 focus:bg-neutral-100 data-[disabled]:cursor-default data-[disabled]:opacity-50 dark:hover:bg-neutral-800 dark:focus:bg-neutral-800'
                >
                  Autonomy Edge project…
                </PrimitiveDropdown.Item>
              </PrimitiveDropdown.Content>
            </PrimitiveDropdown.Root>
            <MenuItem ghosted onClick={handleOpenDocumentation}>
              {/* `shrink-0`: this label is the longest in the menu, and a flex row squeezed the icon to zero width. */}
              <DocumentationIcon className='shrink-0' /> Documentation
            </MenuItem>
            {/* Above the divider with the actions; the account is not on the way out. */}
            <StartAccountSection />
          </MenuSection>
          <MenuDivider />
          <MenuSection id='2'>
            <MenuItem onClick={handleExitAppRequest} ghosted>
              <StickArrowIcon className='rotate-180 stroke-brand' /> Exit
            </MenuItem>
          </MenuSection>
        </MenuRoot>
      </StartSideContent>
      <StartMainContent>
        <ProjectFilterBar setSearchFilterValue={searchFilter} setOrderBy={setOrderBy} />
        {/* Hidden entirely when there is nothing to show; the filter box covers both sections. */}
        <StartCloudProjects searchNameFilterValue={searchFilterValue} revision={cloudRevision} orderBy={orderBy} />
        <DisplayRecentProjects
          searchNameFilterValue={searchFilterValue}
          onProjectUploaded={() => setCloudRevision((current) => current + 1)}
        />
      </StartMainContent>
      <OpenCloudProjectModal open={openCloudOpen} onOpenChange={setOpenCloudOpen} />
    </>
  )
}

export { StartScreen }
