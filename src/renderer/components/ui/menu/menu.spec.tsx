import '@testing-library/jest-dom'
import { render } from '@testing-library/react'
import React from 'react'
import Menu from './index'

describe('Menu Root Component', () => {
	test('renders correctly with children and HTML attributes', () => {
		// Arrange
		const customProp = 'custom-value'
		const testChildren = <div data-testid='test-child'>Test Child</div>

		// Act
		const { container, getByTestId } = render(
			<Menu.Root data-testid='root-test-id' data-custom-prop={customProp}>
				{testChildren}
			</Menu.Root>
		)

		// Assert
		// Check if the root element has the specified data-testid and data-custom-prop
		const rootElement = getByTestId('root-test-id')
		expect(rootElement).toBeInTheDocument()
		expect(rootElement).toHaveAttribute('data-custom-prop', customProp)

		// Check if the children are rendered within the root component
		const childElement = getByTestId('test-child')
		expect(childElement).toBeInTheDocument()

		// Check if the component matches the snapshot
		expect(container).toMatchSnapshot()
	})
})

describe('Menu Section Component', () => {
	test('renders correctly with children and HTML attributes', () => {
		// Arrange
		const customProp = 'custom-value'
		const testChildren = <div data-testid='test-child'>Test Child</div>

		// Act
		const { container, getByTestId } = render(
			<Menu.Section data-testid='section-test-id' data-custom-prop={customProp}>
				{testChildren}
			</Menu.Section>
		)

		// Assert
		// Check if the section element has the specified data-testid and data-custom-prop
		const sectionElement = getByTestId('section-test-id')
		expect(sectionElement).toBeInTheDocument()
		expect(sectionElement).toHaveAttribute('data-custom-prop', customProp)

		// Check if the children are rendered within the section component
		const childElement = getByTestId('test-child')
		expect(childElement).toBeInTheDocument()

		// Check if the component matches the snapshot
		expect(container).toMatchSnapshot()
	})
})

describe('Menu Button Component', () => {
	test('renders correctly with children and HTML attributes', () => {
		// Arrange
		const customProp = 'custom-value'
		const buttonIcon = 'test-icon'
		const label = 'test-label'
		const testChildren = (
			<div data-testid='test-child'>
				{buttonIcon} {label}
			</div>
		)

		// Act
		const { getByTestId } = render(
			<Menu.Button
				icon={'test-icon'}
				label='test-label'
				data-testid='button-test-id'
				data-custom-prop={customProp}
			>
				{testChildren}
			</Menu.Button>
		)

		// Assert
		// Check if the button element has the specified data-testid and data-custom-prop
		const buttonElement = getByTestId('button-test-id')
		expect(buttonElement).toBeInTheDocument()
		expect(buttonElement).toHaveAttribute('data-custom-prop', customProp)
	})
})

describe('Menu Divider Component', () => {
	test('renders correctly with children and HTML attributes', () => {
		// Arrange
		const customProp = 'custom-value'

		// Act
		const { getByTestId } = render(
			<Menu.Divider
				data-testid='divider-test-id'
				data-custom-prop={customProp}
			></Menu.Divider>
		)

		// Assert
		// Check if the divider element has the specified data-testid and data-custom-prop
		const dividerElement = getByTestId('divider-test-id')
		expect(dividerElement).toBeInTheDocument()
		expect(dividerElement).toHaveAttribute('data-custom-prop', customProp)
	})
})
