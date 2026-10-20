import { act, render, screen } from '@testing-library/react'

import { CursorFollower } from '..'

describe('CursorFollower', () => {
  it('starts at the initial position plus the offset and follows the pointer', () => {
    render(
      <CursorFollower initialPosition={{ x: 10, y: 20 }} offset={{ x: 5, y: 5 }} label='Coil'>
        <span>icon</span>
      </CursorFollower>,
    )
    const follower = screen.getByTestId('cursor-follower')
    expect(follower.style.transform).toBe('translate(15px, 25px)')
    expect(follower.textContent).toBe('iconCoil')

    act(() => {
      document.dispatchEvent(new MouseEvent('pointermove', { clientX: 100, clientY: 200 }))
    })
    expect(follower.style.transform).toBe('translate(105px, 205px)')

    act(() => {
      document.dispatchEvent(new MouseEvent('dragover', { clientX: 1, clientY: 2 }))
    })
    expect(follower.style.transform).toBe('translate(6px, 7px)')
  })

  it('never intercepts pointer events', () => {
    render(
      <CursorFollower initialPosition={{ x: 0, y: 0 }}>
        <span>icon</span>
      </CursorFollower>,
    )
    expect(screen.getByTestId('cursor-follower').className).toContain('pointer-events-none')
  })
})
