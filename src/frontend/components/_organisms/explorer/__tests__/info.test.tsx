import { render, screen } from '@testing-library/react'

import { Info } from '../info'

describe('Info', () => {
  it('renders documentation text when provided', () => {
    render(<Info selectedPouDocumentation='This is a function block for motor control.' />)
    expect(screen.getByText('This is a function block for motor control.')).toBeTruthy()
  })

  it('renders "No file selected" when documentation is null', () => {
    render(<Info selectedPouDocumentation={null} />)
    expect(screen.getByText('No file selected')).toBeTruthy()
  })

  it('renders the info panel container', () => {
    const { container } = render(<Info selectedPouDocumentation='docs' />)
    expect(container.querySelector('#info-panel-container')).toBeTruthy()
  })

  it('renders the info panel paragraph', () => {
    const { container } = render(<Info selectedPouDocumentation='some doc' />)
    const panel = container.querySelector('#info-panel')
    expect(panel).toBeTruthy()
    expect(panel!.textContent).toBe('some doc')
  })

  it('renders "No file selected" for empty string documentation', () => {
    render(<Info selectedPouDocumentation='' />)
    // Empty string is falsy, so it should show 'No file selected'
    expect(screen.getByText('No file selected')).toBeTruthy()
  })
})
