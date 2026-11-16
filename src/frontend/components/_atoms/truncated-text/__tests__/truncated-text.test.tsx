import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { TooltipProvider } from '../../tooltip'
import { TruncatedText } from '../index'

const CHAR_WIDTH = 10
let columnWidth = 100
const observers: Array<() => void> = []

/** jsdom has no layout: each character is 10px wide and the column is `columnWidth` px. */
const geometry: Array<[keyof HTMLElement, PropertyDescriptor | undefined]> = [
  ['scrollWidth', Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth')],
  ['clientWidth', Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')],
]
const previousResizeObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver')

class FakeResizeObserver {
  private readonly callback: () => void
  constructor(callback: () => void) {
    this.callback = callback
  }
  observe() {
    observers.push(this.callback)
  }
  disconnect() {
    const index = observers.indexOf(this.callback)
    if (index >= 0) observers.splice(index, 1)
  }
  unobserve() {}
}

beforeEach(() => {
  columnWidth = 100
  observers.length = 0
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return (this.textContent ?? '').length * CHAR_WIDTH
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => columnWidth,
  })
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, writable: true, value: FakeResizeObserver })
})

afterEach(() => {
  for (const [key, descriptor] of geometry) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor)
    else Reflect.deleteProperty(HTMLElement.prototype, key)
  }
  if (previousResizeObserver) Object.defineProperty(globalThis, 'ResizeObserver', previousResizeObserver)
  else Reflect.deleteProperty(globalThis, 'ResizeObserver')
})

const renderText = (text: string) =>
  render(
    <TooltipProvider>
      <button type='button'>before</button>
      <TruncatedText text={text} testId='cell' />
    </TooltipProvider>,
  )

describe('TruncatedText', () => {
  it('makes a clipped value a tab stop that opens the full value on focus', async () => {
    const user = userEvent.setup()
    renderText('A_VERY_LONG_IO_POINT_NAME')

    expect(screen.getByTestId('cell').getAttribute('tabindex')).toBe('0')

    await user.tab()
    await user.tab()

    expect(document.activeElement).toBe(screen.getByTestId('cell'))
    expect((await screen.findByTestId('truncated-text-tooltip')).textContent).toContain('A_VERY_LONG_IO_POINT_NAME')
  })

  it('leaves a value that fits out of the tab order and shows no tooltip', async () => {
    const user = userEvent.setup()
    renderText('SHORT')

    expect(screen.getByTestId('cell').hasAttribute('tabindex')).toBe(false)

    await user.tab()
    await user.tab()

    expect(document.activeElement).not.toBe(screen.getByTestId('cell'))
    expect(screen.queryByTestId('truncated-text-tooltip')).toBeNull()
  })

  it('becomes a tab stop when the column shrinks and stops being one when it grows back', () => {
    renderText('EIGHT_CH')
    const cell = screen.getByTestId('cell')
    expect(cell.hasAttribute('tabindex')).toBe(false)

    columnWidth = 50
    act(() => observers.forEach((notify) => notify()))
    expect(cell.getAttribute('tabindex')).toBe('0')

    columnWidth = 200
    act(() => observers.forEach((notify) => notify()))
    expect(cell.hasAttribute('tabindex')).toBe(false)
  })
})
