import { FileElement } from '@components/elements'
import { toast } from '@root/renderer/components/_features/[app]/toast/use-toast'
import { useOpenPLCStore } from '@root/renderer/store'
import { ComponentProps, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

export type IDisplayRecentProjectProps = ComponentProps<'section'>

const DisplayRecentProjects = (props: IDisplayRecentProjectProps) => {
  const {
    workspace: { recents },
    editorActions: { clearEditor },
    workspaceActions: { setUserWorkspace },
    tabsActions: { clearTabs },
  } = useOpenPLCStore()
  const navigate = useNavigate()
  const [recentProjects, setRecentProjects] = useState(recents)

  const getUserRecentProjects = async () => {
    const recentProjects = await window.bridge.retrieveRecents()
    setRecentProjects(recentProjects)
  }

  useEffect(() => {
    void getUserRecentProjects()
  }, [recents])

  const handleOpenProject = async (projectPath: string) => {
    const { success, data, error } = await window.bridge.openProjectByPath(projectPath)

    if (success && data) {
      setUserWorkspace({
        editingState: 'unsaved',
        projectPath: data.meta.path,
        projectData: data.content,
        projectName: 'new-project',
        recents: [],
      })
      clearEditor()
      clearTabs()
      navigate('/workspace')
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
      <h2 className='mb-6 flex w-full flex-1 cursor-default justify-start font-caption text-xl font-medium text-neutral-1000 dark:text-white'>
        Projects
      </h2>
      <div className='scroll-area flex h-full w-full gap-4'>
        {recentProjects.map((project) => (
          <FileElement.Root
            onClick={() => void handleOpenProject(project.path)}
            className='overflow-hidden '
            key={project.path}
          >
            <FileElement.Label projectName={project.path} lastModified={project.lastOpenedAt} />
            <FileElement.Shape />
          </FileElement.Root>
        ))}
      </div>
    </section>
  )
}

export default DisplayRecentProjects

export type DisplayRecentProjectsComponent = typeof DisplayRecentProjects
