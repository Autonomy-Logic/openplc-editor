import { FileElement } from '@components/elements'
import { ComponentProps } from 'react'

import RecentProjects from '../../../../../../shared/data/mock/projects-data.json'

export type IDisplayRecentProjectProps = ComponentProps<'section'>

const DisplayRecentProjects = (props: IDisplayRecentProjectProps) => {
  return (
    <section className='flex flex-col w-full h-[52%] 2xl:h-3/5 3xl:h-3/4 4xl:h-4/5 pr-9 4xl:pr-0' {...props}>
      <h2 className='flex flex-1 w-full mb-6 justify-start text-xl font-caption font-medium text-neutral-1000 dark:text-white cursor-default'>
        Projects
      </h2>
      <div className='scroll-area'>
        {RecentProjects.map((project) => (
          <FileElement.Root key={project.id}>
            <FileElement.Label projectName={project.name} lastModified={project.last_modified} />
            <FileElement.Shape />
          </FileElement.Root>
        ))}
      </div>
    </section>
  )
}

export default DisplayRecentProjects

export type DisplayRecentProjectsComponent = typeof DisplayRecentProjects
