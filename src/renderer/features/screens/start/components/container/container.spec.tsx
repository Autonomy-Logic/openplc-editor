import '@testing-library/jest-dom'
import { render } from '@testing-library/react'
import React from 'react'
import Container from './index'

describe('Container component', () => {
	it('renders with provided props', () => {
		const { container } = render(<Container data-testid='test-container' />)
		const mainElement = container.querySelector('main')

		expect(mainElement).toBeInTheDocument()

		expect(mainElement).toHaveClass(
			'w-full h-full flex  py-4 justify-evenly px-16 min-h-[624px] min-w-[1024px]'
		)
	})
})
