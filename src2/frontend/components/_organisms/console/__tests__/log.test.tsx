import { render, screen } from '@testing-library/react'

import { LogComponent, type LogLevel } from '../log'

describe('LogComponent', () => {
  it('renders message text', () => {
    render(<LogComponent message='Hello world' tstamp='' />)
    expect(screen.getByText('Hello world')).toBeTruthy()
  })

  it('does not render when message is empty', () => {
    const { container } = render(<LogComponent message='' tstamp='' />)
    // The component wraps in a fragment; empty message renders nothing inside
    expect(container.querySelector('.group')).toBeNull()
  })

  it('applies debug CSS class', () => {
    render(<LogComponent level='debug' message='debug msg' tstamp='10:00:00' />)
    const paragraph = screen.getByText(/debug msg/)
    expect(paragraph.className).toContain('text-neutral-500')
  })

  it('applies info CSS class', () => {
    render(<LogComponent level='info' message='info msg' tstamp='10:00:00' />)
    const paragraph = screen.getByText(/info msg/)
    expect(paragraph.className).toContain('text-brand-medium')
  })

  it('applies warning CSS class', () => {
    render(<LogComponent level='warning' message='warn msg' tstamp='10:00:00' />)
    const paragraph = screen.getByText(/warn msg/)
    expect(paragraph.className).toContain('text-yellow-600')
  })

  it('applies error CSS class', () => {
    render(<LogComponent level='error' message='error msg' tstamp='10:00:00' />)
    const paragraph = screen.getByText(/error msg/)
    expect(paragraph.className).toContain('text-red-500')
  })

  it('shows timestamp when level and tstamp provided', () => {
    render(<LogComponent level='info' message='test message' tstamp='12:34:56' />)
    // Timestamp and message are split across text nodes within the same <p>
    const paragraph = screen.getByText((_content, element) => {
      return element?.tagName === 'P' && element?.textContent === '[12:34:56]: test message'
    })
    expect(paragraph).toBeTruthy()
  })

  it('does not show timestamp brackets when no level provided', () => {
    render(<LogComponent message='plain message' tstamp='12:34:56' />)
    const paragraph = screen.getByText('plain message')
    expect(paragraph.textContent).toBe('plain message')
  })

  it('renders copy button', () => {
    render(<LogComponent message='copy me' tstamp='' />)
    const button = screen.getByTitle('Copy to clipboard')
    expect(button).toBeTruthy()
    // Copy button has opacity-0 and group-hover:opacity-100
    expect(button.className).toContain('opacity-0')
    expect(button.className).toContain('group-hover:opacity-100')
  })

  it('renders copy icon inside button', () => {
    render(<LogComponent message='msg' tstamp='' />)
    const button = screen.getByTitle('Copy to clipboard')
    // The Copy icon from lucide-react renders an SVG inside the button
    const svg = button.querySelector('svg')
    expect(svg).toBeTruthy()
  })
})

describe('HighlightedText (via LogComponent)', () => {
  it('highlights matching search terms', () => {
    render(<LogComponent message='Hello world test' tstamp='' searchTerm='world' />)
    const mark = document.querySelector('mark')
    expect(mark).toBeTruthy()
    expect(mark!.textContent).toBe('world')
  })

  it('highlights case-insensitively', () => {
    render(<LogComponent message='Hello WORLD test' tstamp='' searchTerm='world' />)
    const mark = document.querySelector('mark')
    expect(mark).toBeTruthy()
    expect(mark!.textContent).toBe('WORLD')
  })

  it('highlights multiple occurrences', () => {
    render(<LogComponent message='test one test two test' tstamp='' searchTerm='test' />)
    const marks = document.querySelectorAll('mark')
    expect(marks.length).toBe(3)
  })

  it('does not highlight when searchTerm is empty', () => {
    render(<LogComponent message='Hello world' tstamp='' searchTerm='' />)
    const mark = document.querySelector('mark')
    expect(mark).toBeNull()
  })

  it('does not highlight when searchTerm is undefined', () => {
    render(<LogComponent message='Hello world' tstamp='' />)
    const mark = document.querySelector('mark')
    expect(mark).toBeNull()
  })

  it('renders normally when search term does not match', () => {
    render(<LogComponent message='Hello world' tstamp='' searchTerm='xyz' />)
    const mark = document.querySelector('mark')
    expect(mark).toBeNull()
    expect(screen.getByText('Hello world')).toBeTruthy()
  })
})
