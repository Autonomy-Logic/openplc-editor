import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { useOpenPLCStore } from '~/renderer/store'
import Editor from './index'

// Mocking useOpenPLCStore
jest.mock('~/renderer/store', () => ({
	useOpenPLCStore: {
		useProjectData: jest.fn(),
		useProjectPath: jest.fn(),
	},
}))

// Mocking useLocation
jest.mock('react-router-dom', () => ({
	useLocation: jest.fn(),
}))

describe('Editor Component', () => {
	it('renders Editor component with default values', () => {
		// Mocking hook responses
		;(useOpenPLCStore.useProjectData as jest.Mock).mockReturnValue(null)
		;(useOpenPLCStore.useProjectPath as jest.Mock).mockReturnValue('')

		// Render the component
		render(<Editor />)

		// Assert
		expect(screen.getByText(/Path:/)).toBeInTheDocument()
		expect(screen.getByText(/Data:/)).toBeInTheDocument()
	})
})
