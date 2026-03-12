import { FileElement } from '../../_atoms'
import { toast } from '../../_features/[app]/toast/use-toast'
import { useOpenPLCStore } from '../../../store'
import { useSystem, useProject } from '../../../../middleware/shared/providers'
import { ComponentProps, useEffect, useRef, useState } from 'react'

export type IDisplayRecentProjectProps = ComponentProps<'section'> & {
  searchNameFilterValue: string
}

const DisplayRecentProjects = ({ searchNameFilterValue, ...props }: IDisplayRecentProjectProps) => {
  const {
    workspace: { recent },
    workspaceActions: { setRecent },
  } = useOpenPLCStore()

  const system = useSystem()
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

  const updateUserRecentProjects = async () => {
    const recentList = await system.getStoreValue('recentProjects')
    if (Array.isArray(recentList)) {
      setRecent(recentList as typeof recent)
    }
  }

  const handleOpenProjectByPath = async (projectPath: string) => {
    const result = await project.openProject(projectPath)
    if (!result.ok) {
      void updateUserRecentProjects()
      toast({
        title: 'Cannot open the project.',
        description: result.message ?? `The path ${projectPath} does not exist on this computer.`,
        variant: 'fail',
      })
    }
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
          <FileElement.Root
            onClick={() => void handleOpenProjectByPath(proj.path)}
            className='overflow-hidden '
            key={proj.path}
          >
            <FileElement.Label
              projectName={proj.name}
              projectPath={proj.path}
              lastModified={projectTimes[proj.path]}
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
