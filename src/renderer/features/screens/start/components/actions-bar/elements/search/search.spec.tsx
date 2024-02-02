import '@testing-library/jest-dom'
import { render } from '@testing-library/react'
import Search from './index'

describe('Root Component', () => {
	it('renders with className', () => {
		const { container } = render(<Search.Root className='custom-class' />)
		expect(container.firstChild).toHaveClass('custom-class')
	})

	it('renders with additional props', () => {
		const { container } = render(<Search.Root data-testid='test-id' />)
		expect(container.firstChild).toHaveAttribute('data-testid', 'test-id')
	})
})

describe('Input Component', () => {
	it('renders with className and placeholder', () => {
		const { container } = render(
			<Search.Input className='custom-class' placeholder='Enter text' />
		)
		const inputElement = container.querySelector('input')

		expect(inputElement).toHaveClass('custom-class')
		expect(inputElement).toHaveAttribute('placeholder', 'Enter text')
	})

	it('renders with additional props', () => {
		const { container } = render(<Search.Input data-testid='test-id' />)
		expect(container.querySelector('input')).toHaveAttribute(
			'data-testid',
			'test-id'
		)
	})
})
