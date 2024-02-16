import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import Workspace from './index'

describe('Workspace screen component', () => {
	it('renders Workspace component with default values', () => {
		// Render the component
		render(<Workspace />)

		// Assert
		// The component should render the main container
		expect(screen.getByRole('main')).toBeInTheDocument()
	})
})
