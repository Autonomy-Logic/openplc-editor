import { act, fireEvent, render, screen } from '@testing-library/react'

import { createStoreWrapper, createTestStore } from '../../../../../../../store/testing'
import type { PlacementLanguage } from '../../../../../../../utils/graphical/placement-elements'
import { PLACEMENT_TARGET_ATTRIBUTE } from '../../../../../../../utils/graphical/placement-elements'
import { getSliceAnchor } from '../../../../../../../utils/graphical/radial-menu-geometry'
import { GraphicalPlacementProvider, useGraphicalPlacement } from '../placement-context'

const consumed: Array<string | null> = []

function Area() {
  const placement = useGraphicalPlacement()
  return (
    <div>
      <div
        data-testid='area'
        {...{ [PLACEMENT_TARGET_ATTRIBUTE]: 'test' }}
        onContextMenu={placement?.handleContextMenu}
        onClick={() => consumed.push(placement?.consume() ?? null)}
      />
      <span data-testid='armed'>{placement?.armed ?? 'none'}</span>
      <input data-testid='field' />
    </div>
  )
}

function setup(
  options: { language?: PlacementLanguage; isActive?: boolean; readOnly?: boolean; withProvider?: boolean } = {},
) {
  const { language = 'ld', isActive = true, readOnly = false, withProvider = true } = options
  const store = createTestStore()
  const Wrapper = createStoreWrapper(store)
  const view = render(
    <Wrapper>
      {withProvider ? (
        <GraphicalPlacementProvider language={language} isActive={isActive} readOnly={readOnly}>
          <Area />
        </GraphicalPlacementProvider>
      ) : (
        <Area />
      )}
    </Wrapper>,
  )
  return { store, ...view }
}

const armed = () => screen.getByTestId('armed').textContent
const openMenuAt = (x = 400, y = 300) => fireEvent.contextMenu(screen.getByTestId('area'), { clientX: x, clientY: y })
const altDigit = (digit: number, target: Element = document.body) =>
  fireEvent.keyDown(target, { key: String(digit), code: `Digit${digit}`, altKey: true })

beforeEach(() => {
  consumed.length = 0
  localStorage.clear()
})

describe('GraphicalPlacementProvider', () => {
  it('exposes nothing outside a provider', () => {
    setup({ withProvider: false })
    expect(armed()).toBe('none')
  })

  it('opens the radial menu on a right click in the programming area', () => {
    setup()
    openMenuAt()
    expect(screen.getByTestId('radial-menu')).toBeTruthy()
    expect(screen.getAllByRole('menuitem').map((item) => item.getAttribute('aria-label'))).toEqual([
      'Contact',
      'Coil',
      'Block',
    ])
  })

  it('lists the FBD elements in the FBD editor', () => {
    setup({ language: 'fbd' })
    openMenuAt()
    expect(screen.getAllByRole('menuitem')).toHaveLength(6)
  })

  it('reopens the menu at the new position on another right click', () => {
    setup()
    openMenuAt(400, 300)
    const first = screen.getByTestId('radial-menu').style.left
    openMenuAt(600, 300)
    expect(screen.getAllByTestId('radial-menu')).toHaveLength(1)
    expect(screen.getByTestId('radial-menu').style.left).not.toBe(first)
  })

  it('does not open the menu when it is disabled in the preferences', () => {
    const { store } = setup()
    act(() => store.getState().uiPreferencesActions.setRadialMenuEnabled(false))
    openMenuAt()
    expect(screen.queryByTestId('radial-menu')).toBeNull()
  })

  it('closes an open menu when the preference is turned off', () => {
    const { store } = setup()
    openMenuAt()
    act(() => store.getState().uiPreferencesActions.setRadialMenuEnabled(false))
    expect(screen.queryByTestId('radial-menu')).toBeNull()
  })

  it.each([
    ['the debugger is visible', { debugger: true }],
    ['the editor is read-only', { readOnly: true }],
    ['the editor is not the active tab', { isActive: false }],
    ['the language has no elements', { language: 'sfc' as const }],
  ])('does nothing when %s', (_, flags) => {
    const { store } = setup({
      readOnly: 'readOnly' in flags,
      isActive: !('isActive' in flags),
      language: 'language' in flags ? flags.language : 'ld',
    })
    if ('debugger' in flags) act(() => store.getState().workspaceActions.setDebuggerVisible(true))
    openMenuAt()
    altDigit(1)
    expect(screen.queryByTestId('radial-menu')).toBeNull()
    expect(armed()).toBe('none')
  })

  it('arms the selected element and shows it next to the cursor', () => {
    setup()
    openMenuAt(400, 300)
    const anchor = getSliceAnchor(1, 3, 78)
    fireEvent.click(screen.getByTestId('radial-menu'), { clientX: 400 + anchor.x, clientY: 300 + anchor.y })
    expect(screen.queryByTestId('radial-menu')).toBeNull()
    expect(armed()).toBe('coil')
    expect(screen.getByTestId('cursor-follower').textContent).toContain('Coil')
  })

  it('cancels the armed element on Escape', () => {
    setup()
    altDigit(2)
    expect(armed()).toBe('coil')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(armed()).toBe('none')
    expect(screen.queryByTestId('cursor-follower')).toBeNull()
  })

  it('maps Alt + digit to the ladder elements', () => {
    setup()
    altDigit(1)
    expect(armed()).toBe('contact')
    altDigit(3)
    expect(armed()).toBe('block')
    altDigit(9)
    expect(armed()).toBe('block')
  })

  it('maps Alt + digit to the FBD elements', () => {
    setup({ language: 'fbd' })
    const expected = ['input-variable', 'output-variable', 'block', 'connector', 'continuation', 'comment']
    expected.forEach((id, index) => {
      altDigit(index + 1)
      expect(armed()).toBe(id)
    })
  })

  it('keeps shortcuts working with the radial menu disabled', () => {
    const { store } = setup()
    act(() => store.getState().uiPreferencesActions.setRadialMenuEnabled(false))
    altDigit(1)
    expect(armed()).toBe('contact')
  })

  it('arms from the keyboard while the radial menu is open and closes it', () => {
    setup()
    openMenuAt()
    altDigit(2)
    expect(screen.queryByTestId('radial-menu')).toBeNull()
    expect(armed()).toBe('coil')
  })

  it('arms from a focused text field with the top-row digits', () => {
    setup()
    altDigit(1, screen.getByTestId('field'))
    expect(armed()).toBe('contact')
  })

  it('leaves Alt + numpad digits to a focused text field', () => {
    setup()
    fireEvent.keyDown(screen.getByTestId('field'), { key: '1', code: 'Numpad1', altKey: true })
    expect(armed()).toBe('none')
    fireEvent.keyDown(document.body, { key: '1', code: 'Numpad1', altKey: true })
    expect(armed()).toBe('contact')
  })

  it('ignores shortcuts while a dialog is open', () => {
    setup()
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('data-state', 'open')
    document.body.appendChild(dialog)
    altDigit(1)
    expect(armed()).toBe('none')
    dialog.remove()
  })

  it('hands the armed element to the placement target on click', () => {
    setup()
    altDigit(1)
    act(() => {
      screen.getByTestId('area').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    })
    expect(armed()).toBe('contact')
    fireEvent.click(screen.getByTestId('area'))
    expect(consumed).toEqual(['contact'])
    expect(armed()).toBe('none')
  })

  it('cancels on a left click outside the placement targets', () => {
    setup()
    altDigit(1)
    act(() => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    })
    expect(armed()).toBe('none')
  })

  it('cancels on a right click outside the editor', () => {
    setup()
    altDigit(1)
    act(() => {
      document.body.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2 }))
    })
    expect(armed()).toBe('none')
  })

  it('replaces the armed element with the menu on a right click in the area', () => {
    setup()
    altDigit(1)
    act(() => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 2 }))
    })
    expect(armed()).toBe('contact')
    openMenuAt()
    expect(armed()).toBe('none')
    expect(screen.getByTestId('radial-menu')).toBeTruthy()
  })

  it('cancels when the editor stops being editable', () => {
    const { store } = setup()
    altDigit(1)
    act(() => store.getState().workspaceActions.setDebuggerVisible(true))
    expect(armed()).toBe('none')
  })
})
