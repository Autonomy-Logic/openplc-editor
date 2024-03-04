// TODO: Remove mock data
import MockImage from '~renderer/assets/images/example.png'

import Card from '~renderer/components/elements/card'

// TODO: Remove mock data
import Mock from '../../../../../../shared/data/mock/examples.json'
import { ComponentProps } from 'react'

type IDisplayExampleProjectProps = ComponentProps<'section'>

const DisplayExampleProjects = (props: IDisplayExampleProjectProps) => {
	return (
		<section
			className='flex pr-9 flex-col w-full bg-none mb-8 4xl:pr-0'
			{...props}
		>
			<h2 className='flex pr-3 flex-1 w-full mb-3 justify-between text-xl leading-6 font-medium font-caption text-neutral-1000 dark:text-white cursor-default'>
				Example Projects
			</h2>
			<div className='scroll-area-horizontal mr-5'>
				{Mock.map((project) => (
					<Card.Root key={project.id}>
						<Card.Preview source={MockImage} />
						<Card.Label
							title={project.name}
							description={project.description}
						/>
					</Card.Root>
				))}
			</div>
		</section>
	)
}

export default DisplayExampleProjects
export type DisplayExampleProjectsComponent = typeof DisplayExampleProjects
