import { fireEvent, render } from '@testing-library/react'

import { isBottomPanelShortcut, useBottomPanelShortcut } from '../use-bottom-panel-shortcut'

const key = (init: Partial<KeyboardEvent>) => ({
  key: 'j',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...init,
})

describe('isBottomPanelShortcut', () => {
  it('matches Ctrl+J and Cmd+J, in either case', () => {
    expect(isBottomPanelShortcut(key({ ctrlKey: true }))).toBe(true)
    expect(isBottomPanelShortcut(key({ metaKey: true }))).toBe(true)
    expect(isBottomPanelShortcut(key({ ctrlKey: true, key: 'J' }))).toBe(true)
  })

  it('ignores J alone, other keys and extra modifiers', () => {
    expect(isBottomPanelShortcut(key({}))).toBe(false)
    expect(isBottomPanelShortcut(key({ ctrlKey: true, key: 'k' }))).toBe(false)
    expect(isBottomPanelShortcut(key({ ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(isBottomPanelShortcut(key({ metaKey: true, altKey: true }))).toBe(false)
  })
})

const Harness = ({ onToggle }: { onToggle: () => void }) => {
  useBottomPanelShortcut(onToggle)
  return <textarea aria-label='code' />
}

describe('useBottomPanelShortcut', () => {
  it('toggles once per press, even from a focused text field, and stops the key there', () => {
    const onToggle = jest.fn()
    const { getByLabelText, unmount } = render(<Harness onToggle={onToggle} />)
    const field = getByLabelText('code')
    const fieldKeyDown = jest.fn()
    field.addEventListener('keydown', fieldKeyDown)

    const pressed = fireEvent.keyDown(field, { key: 'j', ctrlKey: true })
    fireEvent.keyDown(field, { key: 'j', ctrlKey: true, repeat: true })
    fireEvent.keyDown(field, { key: 'j' })

    expect(pressed).toBe(false)
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(fieldKeyDown).toHaveBeenCalledTimes(1)

    unmount()
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true })
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})
