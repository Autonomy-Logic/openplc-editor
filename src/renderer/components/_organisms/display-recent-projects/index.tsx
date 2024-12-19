import { FileElement } from '@components/elements'
import { toast } from '@root/renderer/components/_features/[app]/toast/use-toast'
import { useOpenPLCStore } from '@root/renderer/store'
import type { FlowType } from '@root/renderer/store/slices'
import { ComponentProps, useEffect, useState } from 'react'

export type IDisplayRecentProjectProps = ComponentProps<'section'>

const DisplayRecentProjects = (props: IDisplayRecentProjectProps) => {
  const {
    workspace: { recents },
    editorActions: { clearEditor },
    workspaceActions: { setEditingState, setRecents },
    projectActions: { setProject },
    tabsActions: { clearTabs },
    flowActions: { addFlow },
    libraryActions: { addLibrary },
  } = useOpenPLCStore()

  const [recentProjects, setRecentProjects] = useState(recents)
  const [projectTimes, setProjectTimes] = useState<{ [key: string]: string }>({})

  const getUserRecentProjects = async () => {
    const recentProjects = await window.bridge.retrieveRecents()
    setRecentProjects(recentProjects)
  }

  useEffect(() => {
    void getUserRecentProjects()
  }, [recents])

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
    const updatedTimes = recentProjects.reduce(
      (acc, project) => {
        acc[project.path] = compareLastOpened(project.lastOpenedAt)
        return acc
      },
      {} as { [key: string]: string },
    )

    setProjectTimes(updatedTimes)
  }

  useEffect(() => {
    updateProjectTimes()

    const timers = recentProjects.map((project) => {
      const lastOpenedDate = new Date(project.lastOpenedAt)
      const now = new Date()

      const timeSinceLastOpened = now.getTime() - lastOpenedDate.getTime()
      const timeUntilNextMinute = 60000 - (timeSinceLastOpened % 60000)

      const timerId = setTimeout(() => {
        updateProjectTimes()

        setInterval(() => {
          updateProjectTimes()
        }, 60000)
      }, timeUntilNextMinute)

      return timerId
    })

    return () => {
      timers.forEach((timerId) => clearTimeout(timerId))
    }
  }, [recentProjects])

  const handleOpenProject = async (projectPath: string) => {
    const { success, data, error } = await window.bridge.openProjectByPath(projectPath)
    if (success && data) {
      setEditingState('unsaved')
      setRecents([])
      clearEditor()
      clearTabs()

      const projectMeta = {
        name: data.content.meta.name,
        type: data.content.meta.type,
        path: data.meta.path,
      }
      const projectData = data.content.data

      setProject({
        meta: projectMeta,
        data: projectData,
      })
      const ladderPous = projectData.pous.filter((pou) => pou.data.language === 'ld')

      if (ladderPous.length) {
        ladderPous.forEach((pou) => {
          if (pou.data.body.language === 'ld') {
            addFlow(pou.data.body.value as FlowType)
          }
        })
      }

      projectData.pous.map((pou) => pou.type !== 'program' && addLibrary(pou.data.name, pou.type))

      toast({
        title: 'Project opened!',
        description: 'Your project was opened and loaded.',
        variant: 'default',
      })
    } else {
      if (error?.description.includes('Error reading project file.')) {
        void getUserRecentProjects()
        toast({
          title: 'Path does not exist.',
          description: `The path ${projectPath} does not exist on this computer.`,
          variant: 'fail',
        })
      } else {
        void getUserRecentProjects(),
          toast({
            title: 'Cannot open the project.',
            description: error?.description,
            variant: 'fail',
          })
      }
    }
  }

  return (
    <section className='flex h-[52%] w-full flex-col pr-9 2xl:h-3/5 3xl:h-3/4 4xl:h-4/5 4xl:pr-0' {...props}>
      <h2 className='mb-6 flex  cursor-default justify-start font-caption text-xl font-medium text-neutral-1000 dark:text-white'>
        Projects
      </h2>
      <div className='scroll-area flex h-auto w-full flex-wrap  gap-[25px] overflow-y-auto'>
        {recentProjects.map((project) => (
          <FileElement.Root
            onClick={() => void handleOpenProject(project.path)}
            className='overflow-hidden '
            key={project.path}
          >
            <FileElement.Label
              projectName={project.name}
              projectPath={project.path}
              lastModified={projectTimes[project.path]}
            />
            <FileElement.Shape />
          </FileElement.Root>
        ))}
      </div>
    </section>
  )
}

export default DisplayRecentProjects

export type DisplayRecentProjectsComponent = typeof DisplayRecentProjects
