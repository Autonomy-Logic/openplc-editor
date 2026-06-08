import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ComponentProps, useEffect, useRef, useState } from 'react'

import { useProject } from '../../../../middleware/shared/providers'
import { useOpenPLCStore } from '../../../store'
import { cn } from '../../../utils/cn'
import { File } from '../../_atoms/file'
import { toast } from '../../_features/[app]/toast/use-toast'

export type IDisplayRecentProjectProps = ComponentProps<'section'> & {
  searchNameFilterValue: string
}

const DisplayRecentProjects = ({ searchNameFilterValue, ...props }: IDisplayRecentProjectProps) => {
  const {
    workspace: { recent },
    workspaceActions: { setRecent },
    modalActions: { openModal },
    sharedWorkspaceActions: { handleOpenProjectResponse },
  } = useOpenPLCStore()

  const project = useProject()

  const [recentProjects, setRecentProjects] = useState(recent)
  const [projectTimes, setProjectTimes] = useState<{ [key: string]: string }>({})
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    setRecentProjects(recent)
  }, [recent])

  useEffect(() => {
    const filtered =
      searchNameFilterValue.length === 0
        ? recent
        : recent.filter((proj) => proj.name?.toLowerCase().includes(searchNameFilterValue.toLowerCase()))

    setRecentProjects(filtered)
  }, [searchNameFilterValue, recent])

  const compareLastOpened = (lastOpenedAt: string) => {
    const currentTime = new Date()
    const lastOpenedDate = new Date(lastOpenedAt)

    const differenceInMs = currentTime.getTime() - lastOpenedDate.getTime()

    const differenceInMinutes = Math.floor(differenceInMs / (1000 * 60))
    const differenceInHours = Math.floor(differenceInMs / (1000 * 60 * 60))
    const differenceInDays = Math.floor(differenceInMs / (1000 * 60 * 60 * 24))

    if (differenceInMinutes < 60) {
      return differenceInMinutes === 1
        ? `modified ${differenceInMinutes} minute ago`
        : `modified ${differenceInMinutes} minutes ago`
    } else if (differenceInHours < 24) {
      return differenceInHours === 1
        ? `modified ${differenceInHours} hour ago`
        : `modified ${differenceInHours} hours ago`
    } else {
      return differenceInDays === 1 ? `modified ${differenceInDays} day ago` : `modified ${differenceInDays} days ago`
    }
  }

  const updateProjectTimes = () => {
    const updatedTimes = recent.reduce(
      (acc, proj) => {
        acc[proj.path] = compareLastOpened(proj.lastOpenedAt)
        return acc
      },
      {} as { [key: string]: string },
    )

    if (JSON.stringify(updatedTimes) !== JSON.stringify(projectTimes)) {
      setProjectTimes(updatedTimes)
    }
  }

  useEffect(() => {
    updateProjectTimes()

    intervalRef.current = setInterval(() => {
      updateProjectTimes()
    }, 60000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  // Refetch from projects.json (the same source as the initial hydration).
  // The project service evicts the dead entry on ENOENT before returning,
  // so this read shows the post-eviction list.
  const updateUserRecentProjects = async () => {
    const recentList = await project.getRecentProjects()
    setRecent(recentList)
  }

  const handleOpenProjectByPath = async (projectPath: string) => {
    const result = await project.openProjectByPath(projectPath)
    if (result.success && result.data) {
      handleOpenProjectResponse(result.data)
      return
    }
    void updateUserRecentProjects()
    toast({
      title: 'Cannot open the project.',
      description: result.error?.description ?? `The path ${projectPath} does not exist on this computer.`,
      variant: 'fail',
    })
  }

  // "Remove from list" — disk untouched. Fires immediately, no
  // confirmation: the project files stay where they are, re-opening
  // the project re-adds it to recents. The sibling "Delete project"
  // action routes through the confirm-delete-project modal because
  // its blast radius is `rm -rf` on the project directory.
  const handleRemoveFromList = async (projectPath: string) => {
    const result = await project.removeRecentProject(projectPath)
    if (!result.success) {
      toast({
        title: 'Could not remove from list',
        description: result.error ?? 'An unexpected error occurred. Please try again.',
        variant: 'fail',
      })
    }
    const refreshed = await project.getRecentProjects()
    setRecent(refreshed)
  }

  const handleDeleteProjectRequest = (projectName: string, projectPath: string) => {
    openModal('confirm-delete-project', { projectName, projectPath })
  }

  return (
    <section
      className='flex h-[52%] w-full select-none flex-col pr-9 2xl:h-3/5 3xl:h-3/4 4xl:h-4/5 4xl:pr-0'
      {...props}
    >
      <h2 className='mb-6 flex  cursor-default justify-start font-caption text-xl font-medium text-neutral-1000 dark:text-white'>
        Projects
      </h2>
      <div className='scroll-area flex h-auto w-full flex-wrap  gap-[25px] overflow-y-auto'>
        {recentProjects.map((proj) => (
          <div key={proj.path} className='group relative'>
            <File
              onClick={() => void handleOpenProjectByPath(proj.path)}
              className='overflow-hidden'
              projectName={proj.name}
              projectPath={proj.path}
              lastModified={projectTimes[proj.path]}
            />
            {/* 3-dot overflow menu — always visible, positioned on
             *  the SVG folder BODY's top-right (not the tab above
             *  it). The folder shape's body starts at y≈33 inside a
             *  160px-tall card, so `top-10` (40px) sits just inside
             *  the blue body and leaves the tab clean. Stops click
             *  propagation so opening the menu doesn't also fire
             *  the card's onClick (open project). */}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  aria-label='Project actions'
                  onClick={(e) => e.stopPropagation()}
                  className='absolute right-2 top-10 rounded p-1 hover:bg-black/20 focus:outline-none dark:hover:bg-black/40'
                  title='More actions'
                >
                  <svg className='h-4 w-4 text-white' viewBox='0 0 16 16' fill='currentColor' aria-hidden='true'>
                    <path d='M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM1.5 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm13 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z' />
                  </svg>
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  side='bottom'
                  align='end'
                  sideOffset={4}
                  onCloseAutoFocus={(e) => e.preventDefault()}
                  className='z-[60] min-w-[180px] overflow-hidden rounded-md border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900'
                >
                  <DropdownMenu.Item
                    onSelect={() => void handleRemoveFromList(proj.path)}
                    className={cn(
                      'flex cursor-pointer select-none items-center gap-2 px-3 py-1.5 text-xs outline-none',
                      'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800',
                    )}
                  >
                    <svg className='h-3.5 w-3.5 text-neutral-500' viewBox='0 0 16 16' fill='currentColor'>
                      <path d='M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z' />
                    </svg>
                    Remove from list
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={() => handleDeleteProjectRequest(proj.name, proj.path)}
                    className={cn(
                      'flex cursor-pointer select-none items-center gap-2 px-3 py-1.5 text-xs outline-none',
                      'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40',
                    )}
                  >
                    <svg className='h-3.5 w-3.5' viewBox='0 0 16 16' fill='currentColor'>
                      <path d='M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25ZM4.005 5.073a.75.75 0 0 1 .673.627l.79 5.532a.75.75 0 0 0 .742.643h3.58a.75.75 0 0 0 .742-.643l.79-5.532a.75.75 0 0 1 1.49.214l-.79 5.532A2.25 2.25 0 0 1 9.79 13.5H6.21a2.25 2.25 0 0 1-2.23-1.928l-.79-5.532a.75.75 0 0 1 .626-.867Z' />
                    </svg>
                    Delete project
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        ))}
      </div>
    </section>
  )
}

export default DisplayRecentProjects

export type DisplayRecentProjectsComponent = typeof DisplayRecentProjects
