import { describe, expect, it } from '@jest/globals'
import { render } from '@testing-library/react'
import Card from './index'

// Test suite for the Root Component
describe('Root Component', () => {
	// Test to ensure the Root component renders correctly
	test('renders correctly', () => {
		// Render the Card.Root component and get the container
		const { container } = render(<Card.Root />)
		// Compare the rendered container with a snapshot
		expect(container).toMatchSnapshot()
	})

	// Test to check if HTMLAttributes are passed to the Root component
	test('passes HTMLAttributes to the component', () => {
		// Define a custom prop value
		const customProp = 'custom-prop-value'
		// Render the Card.Root component with specific HTMLAttributes
		const { getByTestId } = render(
			<Card.Root data-testid='root-test-id' data-custom-prop={customProp} />
		)

		// Get the Root element by test ID
		const rootElement = getByTestId('root-test-id')
		// Retrieve the custom prop value from the element's attributes
		const rootProps = rootElement.getAttribute('data-custom-prop')

		// Ensure that the Root element exists and has the correct custom prop value
		expect(rootElement).toBeTruthy()
		expect(rootProps).toBe(customProp)
	})
})

// Test suite for the Label Component
describe('Label Component', () => {
	// Test to ensure the Label component renders correctly
	test('renders correctly', () => {
		// Render the Card.Label component with specific title and description
		const { container } = render(
			<Card.Label title='Test title' description='Test description' />
		)
		// Compare the rendered container with a snapshot
		expect(container).toMatchSnapshot()
	})

	// Test to check if HTMLAttributes are passed to the Label component
	test('passes HTMLAttributes to the component', () => {
		// Define a custom prop value
		const customProp = 'custom-prop-value'
		// Render the Card.Label component with specific HTMLAttributes
		const { getByTestId } = render(
			<Card.Label
				data-testid='label-test-id'
				data-custom-prop={customProp}
				title='Test title'
				description='Test description'
			/>
		)

		// Get the Label element by test ID
		const labelElement = getByTestId('label-test-id')
		// Retrieve the custom prop value from the element's attributes
		const labelProps = labelElement.getAttribute('data-custom-prop')

		// Ensure that the Label element exists and has the correct custom prop value
		expect(labelElement).toBeTruthy()
		expect(labelProps).toBe(customProp)
	})
})

// Test suite for the Preview Component
describe('Preview Component', () => {
	// Test to ensure the Preview component renders correctly
	test('renders correctly', () => {
		// Render the Card.Preview component with a specific source
		const { container } = render(<Card.Preview source='Test source' />)
		// Compare the rendered container with a snapshot
		expect(container).toMatchSnapshot()
	})

	// Test to check if HTMLAttributes are passed to the Preview component
	test('passes HTMLAttributes to the component', () => {
		// Define a custom prop value
		const customProp = 'custom-prop-value'
		// Render the Card.Preview component with specific HTMLAttributes
		const { getByTestId } = render(
			<Card.Preview
				data-testid='preview-test-id'
				data-custom-prop={customProp}
				source='Test source'
			/>
		)

		// Get the Preview element by test ID
		const previewElement = getByTestId('preview-test-id')
		// Retrieve the custom prop value from the element's attributes
		const previewProps = previewElement.getAttribute('data-custom-prop')

		// Ensure that the Preview element exists and has the correct custom prop value
		expect(previewElement).toBeTruthy()
		expect(previewProps).toBe(customProp)
	})
})
