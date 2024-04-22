import '@testing-library/jest-dom/jest-globals'

import { fireEvent, getByTestId, render } from '@testing-library/react'

import Dropdown from '.'

// Tests for the Dropdown.Root component
describe('Dropdown Root Component', () => {
  // Test to check if the Root component renders correctly
  test('renders correctly', () => {
    // Render the Root component
    const { container } = render(<Dropdown.Root />)

    // Assert that the rendered component matches the snapshot
    expect(container).toMatchSnapshot()
  })

  // Test to check if HTMLAttributes are passed to the Root component
  test('passes HTMLAttributes to the dropdown component', () => {
    // Define a custom prop value
    const customProp = 'custom-prop-value'

    // Render the Root component with specific HTMLAttributes
    const { getByTestId } = render(<Dropdown.Root data-testid='root-test-id' data-custom-prop={customProp} />)

    // Get the Root element by test ID
    const rootElement = getByTestId('root-test-id')

    // Ensure rootElement is not null before accessing properties
    expect(rootElement).toBeTruthy()

    // Check if it's an element before calling getAttribute
    if (rootElement instanceof Element) {
      const rootProps = rootElement.getAttribute('data-custom-prop')
      expect(rootProps).toBe(customProp)
    } else {
      // If rootElement is not an element, fail the test
      fail('Root element is not an instance of Element')
    }
  })
})

// Tests for the Dropdown.Options component
describe('Options Component', () => {
  const options = [
    { label: 'Option 1', onClick: jest.fn() },
    { label: 'Option 2', onClick: jest.fn() },
    { label: 'Option 3', onClick: jest.fn() },
  ]

  // Test to check if the Options component renders correctly
  test('renders correctly', () => {
    const { container } = render(
      <Dropdown.Options
        setShowOptions={jest.fn()}
        options={options}
        setSelectedOption={jest.fn()}
        className='custom-class'
      />,
    )

    expect(container).toMatchSnapshot()
  })

  // Test to check if options are rendered correctly
  test('renders options correctly', () => {
    const { getByText } = render(
      <Dropdown.Options setShowOptions={jest.fn()} options={options} setSelectedOption={jest.fn()} />,
    )

    for (const option of options) {
      // Use the toBeInTheDocument matcher from @testing-library/jest-dom
      expect(getByText(option.label)).toBeInTheDocument()
    }
  })

  // Test to check if state is updated correctly when an option is clicked
  test('updates state and calls onClick when an option is clicked', () => {
    const setSelectedOption = jest.fn()
    const setShowOptions = jest.fn()

    const { getByText } = render(
      <Dropdown.Options setShowOptions={setShowOptions} options={options} setSelectedOption={setSelectedOption} />,
    )

    const optionToClick = options[1]
    fireEvent.click(getByText(optionToClick.label))

    expect(setSelectedOption).toHaveBeenCalledWith(optionToClick.label)
    expect(optionToClick.onClick).toHaveBeenCalled()
    expect(setShowOptions).toHaveBeenCalledWith(false)
  })
})

// Tests for the Dropdown.Select component
describe('Select Component', () => {
  const mockSetShowOptions = jest.fn()

  // Test to check if the Select component renders correctly
  test('renders correctly', () => {
    const { container } = render(
      <Dropdown.Select
        selectedOption='Option 1'
        Icon={undefined}
        setShowOptions={mockSetShowOptions}
        showOptions={false}
        placeholder='Select an option'
      />,
    )

    expect(container).toMatchSnapshot()
  })

  // Test to check if placeholder text is displayed correctly
  test('displays placeholder text', () => {
    const { getByText } = render(
      <Dropdown.Select
        selectedOption='Option 1'
        Icon={undefined}
        setShowOptions={mockSetShowOptions}
        showOptions={false}
        placeholder='Select an option'
      />,
    )

    expect(getByText('Select an option')).toBeInTheDocument()
  })

  // Test to check if selected option text is displayed correctly
  test('displays selected option text', () => {
    const { getByText } = render(
      <Dropdown.Select
        selectedOption='Option 1'
        Icon={undefined}
        setShowOptions={mockSetShowOptions}
        showOptions={false}
        placeholder='Select an option'
      />,
    )

    expect(getByText('Option 1')).toBeInTheDocument()
  })

  // Test to check if icon is displayed correctly
  test('displays icon', () => {
    const { getByTestId } = render(
      <Dropdown.Select
        selectedOption='Option 1'
        Icon={undefined}
        setShowOptions={mockSetShowOptions}
        showOptions={false}
        placeholder='Select an option'
      />,
    )

    expect(getByTestId('dropdown-icon')).toBeInTheDocument()
  })

  // Test to check if setShowOptions is called on button click
  test('calls setShowOptions on button click', () => {
    const { getByText } = render(
      <Dropdown.Select
        selectedOption='Option 1'
        Icon={undefined}
        setShowOptions={mockSetShowOptions}
        showOptions={false}
        placeholder='Select an option'
      />,
    )

    fireEvent.click(getByText('Select an option'))
    expect(mockSetShowOptions).toHaveBeenCalledTimes(1)
  })
})
