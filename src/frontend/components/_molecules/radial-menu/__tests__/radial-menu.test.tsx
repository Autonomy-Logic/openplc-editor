import { act, fireEvent, render, screen } from '@testing-library/react'

import { getSliceAnchor } from '../../../../utils/graphical/radial-menu-geometry'
import { RadialMenu, type RadialMenuItem } from '..'

const ITEMS: RadialMenuItem[] = [
  { id: 'contact', label: 'Contact', icon: <span>C</span>, hint: 'Alt + 1' },
  { id: 'coil', label: 'Coil', icon: <span>O</span>, hint: 'Alt + 2' },
  { id: 'block', label: 'Block', icon: <span>B</span>, hint: 'Alt + 3' },
]
const CENTER = { x: 500, y: 400 }

const pointAt = (index: number) => {
  const anchor = getSliceAnchor(index, ITEMS.length, 78)
  return { clientX: CENTER.x + anchor.x, clientY: CENTER.y + anchor.y }
}

const dispatch = (target: EventTarget, type: string, init: MouseEventInit = {}) =>
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }))
  })

function setup() {
  const onSelect = jest.fn()
  const onClose = jest.fn()
  render(<RadialMenu items={ITEMS} position={CENTER} onSelect={onSelect} onClose={onClose} title='Ladder' />)
  return { onSelect, onClose, menu: screen.getByTestId('radial-menu') }
}

describe('RadialMenu', () => {
  it('renders one item per entry around the centre with the title in the middle', () => {
    setup()
    expect(screen.getAllByRole('menuitem').map((item) => item.getAttribute('aria-label'))).toEqual([
      'Contact',
      'Coil',
      'Block',
    ])
    expect(screen.getByTestId('radial-menu-label').textContent).toBe('Ladder')
  })

  it('highlights the hovered slice and shows its name and shortcut in the centre', () => {
    const { menu } = setup()
    fireEvent.mouseMove(menu, pointAt(1))
    expect(screen.getByTestId('radial-menu-label').textContent).toBe('Coil')
    expect(menu.textContent).toContain('Alt + 2')
    expect(menu.querySelector('path[data-hovered="true"]')).not.toBeNull()

    fireEvent.mouseLeave(menu)
    expect(screen.getByTestId('radial-menu-label').textContent).toBe('Ladder')
    expect(menu.querySelector('path[data-hovered="true"]')).toBeNull()
  })

  it('selects the clicked slice', () => {
    const { menu, onSelect, onClose } = setup()
    fireEvent.click(menu, pointAt(2))
    expect(onSelect).toHaveBeenCalledWith('block')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes when the hole in the middle is clicked', () => {
    const { menu, onSelect, onClose } = setup()
    fireEvent.click(menu, { clientX: CENTER.x, clientY: CENTER.y })
    expect(onSelect).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape', () => {
    const { onClose } = setup()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores other keys', () => {
    const { onClose } = setup()
    fireEvent.keyDown(document, { key: 'a' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes and swallows a left click outside the menu', () => {
    const { onClose } = setup()
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    const spy = jest.fn()
    outside.addEventListener('pointerdown', spy)

    dispatch(outside, 'pointerdown', { button: 0 })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(spy).not.toHaveBeenCalled()
    outside.remove()
  })

  it('does not close on a right button press outside, only on the context menu event', () => {
    const { onClose } = setup()
    dispatch(document.body, 'pointerdown', { button: 2 })
    expect(onClose).not.toHaveBeenCalled()
    dispatch(document.body, 'contextmenu', { button: 2 })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps itself open on interactions inside the menu', () => {
    const { menu, onClose } = setup()
    dispatch(menu, 'pointerdown', { button: 0 })
    dispatch(menu, 'contextmenu', { button: 2 })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes when the window loses focus', () => {
    const { onClose } = setup()
    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('stays on screen near the viewport edge', () => {
    render(<RadialMenu items={ITEMS} position={{ x: 0, y: 0 }} onSelect={jest.fn()} onClose={jest.fn()} />)
    const menu = screen.getByTestId('radial-menu')
    expect(parseFloat(menu.style.left)).toBeGreaterThanOrEqual(0)
    expect(parseFloat(menu.style.top)).toBeGreaterThanOrEqual(0)
  })
})
