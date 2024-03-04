import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import DisplayExampleProjects from './index'

// // Mock useEmblaCarousel hook
// jest.mock('embla-carousel-react', () => ({
// 	__esModule: true,
// 	default: () => [jest.fn(), { scrollPrev: jest.fn(), scrollNext: jest.fn() }],
// }))

// // Mock images and data
// jest.mock('~renderer/assets/images/example.png', () => 'mockedImage')
// jest.mock('../../../../../../shared/data/mock/examples.json', () => [
// 	{ id: 1, name: 'Example 1', description: 'Description 1' },
// 	{ id: 2, name: 'Example 2', description: 'Description 2' },
// ])

// describe('DisplayExampleProjects', () => {
// 	it('renders correctly', () => {
// 		render(<DisplayExampleProjects />)

// 		expect(screen.getByText('Examples')).toBeInTheDocument()
// 		expect(screen.getByText('Example 1')).toBeInTheDocument()
// 		expect(screen.getByText('Example 2')).toBeInTheDocument()
// 	})

// 	it('scrolls to the previous project', () => {
// 		render(<DisplayExampleProjects />)
// 		fireEvent.click(screen.getByTestId('prevButton'))
// 		expect(screen.getByTestId('prevButton')).toBeEnabled()
// 	})

// 	it('scrolls to the next project', () => {
// 		render(<DisplayExampleProjects />)
// 		fireEvent.click(screen.getByTestId('nextButton'))
// 		expect(screen.getByTestId('nextButton')).toBeEnabled()
// 	})
// })

it('renders correctly', () => {
	render(<DisplayExampleProjects />)
})
