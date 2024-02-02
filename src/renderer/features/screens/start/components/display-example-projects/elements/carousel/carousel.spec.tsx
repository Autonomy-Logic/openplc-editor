import '@testing-library/jest-dom'
import { render } from '@testing-library/react'
import Carousel from './index'

describe('Viewport Component', () => {
	it('renders without crashing', () => {
		const { container } = render(<Carousel.Viewport />)
		expect(container).toBeInTheDocument()
	})

	it('renders with additional class name', () => {
		const { container } = render(<Carousel.Viewport className='custom-class' />)
		expect(container.firstChild).toHaveClass('custom-class')
	})
})

describe('Container Component', () => {
	it('renders without crashing', () => {
		const { container } = render(<Carousel.Container refProvider={() => {}} />)
		expect(container).toBeInTheDocument()
	})

	it('renders with additional class name', () => {
		const { container } = render(
			<Carousel.Container className='custom-class' refProvider={() => {}} />
		)
		expect(container.firstChild).toHaveClass('custom-class')
	})
})
