// TODO: Remove mock data
import Card from '@components/elements/card'
import MockImage from '@process:renderer/assets/images/example.png'
import { ComponentProps } from 'react'

// TODO: Remove mock data
import Mock from '../../../../shared/data/mock/examples.json'

type IDisplayExampleProjectProps = ComponentProps<'section'>

const DisplayExampleProjects = (props: IDisplayExampleProjectProps) => {
  return (
    <section className='mb-8 flex w-full flex-col bg-none pr-9 4xl:pr-0' {...props}>
      <h2 className='mb-3 flex w-full flex-1 cursor-default justify-between pr-3 font-caption text-xl font-medium leading-6 text-neutral-1000 dark:text-white'>
        Example Projects
      </h2>
      <div className='scroll-area-horizontal'>
        {Mock.map((project) => (
          <Card.Root key={project.id}>
            <Card.Preview source={MockImage} />
            <Card.Label title={project.name} description={project.description} />
          </Card.Root>
        ))}
      </div>
    </section>
  )
}

export default DisplayExampleProjects
export type DisplayExampleProjectsComponent = typeof DisplayExampleProjects
