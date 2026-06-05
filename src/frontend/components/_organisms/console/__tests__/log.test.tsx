import { fireEvent, render, screen } from '@testing-library/react'

import type { StructuredCompileError } from '@root/middleware/shared/ports/types'

import { LogComponent } from '../log'

const sampleCompileError = (overrides?: Partial<StructuredCompileError>): StructuredCompileError => ({
  message: 'Cannot assign WSTRING to BOOL',
  line: 9,
  column: 10,
  file: 'Manual_Override.st',
  severity: 'error',
  pouName: 'MANUAL_OVERRIDE',
  pouKind: 'FUNCTION_BLOCK',
  section: 'body',
  bodyLine: 7,
  ...overrides,
})

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

describe('LogComponent compile-error click affordance', () => {
  it('renders the bracketed POU prefix as a clickable button when compileError is present', () => {
    const onClick = jest.fn()
    const message = '[MANUAL_OVERRIDE / body line 7]\nManual_Override.st:7:10: error: ...'
    render(
      <LogComponent
        level='error'
        message={message}
        tstamp='10:00:00'
        compileError={sampleCompileError()}
        onCompileErrorClick={onClick}
      />,
    )
    const button = screen.getByTitle('Open in editor')
    expect(button).toBeTruthy()
    expect(button.tagName).toBe('BUTTON')
    expect(button.textContent).toBe('[MANUAL_OVERRIDE / body line 7]')
  })

  it('invokes onCompileErrorClick with the structured error on click', () => {
    const onClick = jest.fn()
    const err = sampleCompileError()
    render(
      <LogComponent
        level='error'
        message='[MANUAL_OVERRIDE / body line 7]\nrest'
        tstamp='10:00:00'
        compileError={err}
        onCompileErrorClick={onClick}
      />,
    )
    fireEvent.click(screen.getByTitle('Open in editor'))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenCalledWith(err)
  })

  it('falls back to plain rendering when no click handler is provided', () => {
    render(
      <LogComponent
        level='error'
        message='[MANUAL_OVERRIDE / body line 7]\nrest'
        tstamp='10:00:00'
        compileError={sampleCompileError()}
      />,
    )
    // No 'Open in editor' button should appear without a handler.
    expect(screen.queryByTitle('Open in editor')).toBeNull()
  })

  it('renders normally (no button) when compileError is absent', () => {
    const onClick = jest.fn()
    render(
      <LogComponent
        level='error'
        message='[MANUAL_OVERRIDE / body line 7]\nrest'
        tstamp='10:00:00'
        onCompileErrorClick={onClick}
      />,
    )
    expect(screen.queryByTitle('Open in editor')).toBeNull()
  })

  it('still renders the multi-line snippet underneath the clickable prefix', () => {
    const onClick = jest.fn()
    const message = '[MANUAL_OVERRIDE / body line 7]\nManual_Override.st:7:10: error: Cannot assign WSTRING to BOOL'
    render(
      <LogComponent
        level='error'
        message={message}
        tstamp='10:00:00'
        compileError={sampleCompileError()}
        onCompileErrorClick={onClick}
      />,
    )
    expect(screen.getByText(/Manual_Override.st:7:10: error/)).toBeTruthy()
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
