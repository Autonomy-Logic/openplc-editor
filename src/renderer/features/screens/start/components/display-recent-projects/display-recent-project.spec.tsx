import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { ReactNode } from 'react'
import DisplayRecentProjects from './index'

// Mocking the components used within DisplayRecentProjects
jest.mock('~renderer/components/elements', () => ({
	FileElement: {
		Root: ({ children }: { children: ReactNode }) => <div>{children}</div>,
		Label: ({
			projectName,
			lastModified,
		}: {
			projectName: string
			lastModified: string
		}) => (
			<div>
				<span>{projectName}</span>
				<span>{lastModified}</span>
			</div>
		),
		Shape: () => <div>MockedShape</div>,
	},
}))

// Mocking the projects data
jest.mock('../../../../../../shared/data/mock/projects-data.json', () => [
	{ id: 1, name: 'Project 1', last_modified: '2022-01-01' },
	{ id: 2, name: 'Project 2', last_modified: '2022-01-02' },
])

describe('DisplayRecentProjects', () => {
	it('renders correctly with projects', () => {
		render(<DisplayRecentProjects />)
		expect(screen.getByText('Projects')).toBeInTheDocument()
		expect(screen.getByText('Project 1')).toBeInTheDocument()
		expect(screen.getByText('Project 2')).toBeInTheDocument()
	})
})
