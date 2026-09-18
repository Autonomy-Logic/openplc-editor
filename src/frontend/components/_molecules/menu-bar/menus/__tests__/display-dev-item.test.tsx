/**
 * The developer diagnostics entry is absent from a production build.
 *
 * A desktop build has two menus and this is the React one, which rides in the
 * custom title bar. Its native counterpart is gated in `src/main/menu.ts`; the
 * two are tested separately because they are two different menus, and a gate on
 * one says nothing about the other.
 */

import { fireEvent, render, screen } from '@testing-library/react'

// `mock`-prefixed because the factory closes over it and both runners' hoisting
// rules key off that prefix.
let mockIsDevMode = true
jest.mock('@root/middleware/shared/providers', () => ({
  useCapabilities: () => ({ isDevMode: mockIsDevMode }),
  useTheme: () => ({
    getCurrentTheme: () => 'light',
    onThemeChanged: () => () => undefined,
    setTheme: () => undefined,
  }),
}))

import * as MenuPrimitive from '@radix-ui/react-menubar'

import { DisplayMenu } from '../display'

// Radix's trigger opens on Enter — driven with a keydown so the test needs no
// PointerEvent, whose jsdom support varies between the two repos' runners.
const openMenu = () => {
  render(
    <MenuPrimitive.Root>
      <DisplayMenu />
    </MenuPrimitive.Root>,
  )
  fireEvent.keyDown(screen.getByRole('menuitem', { name: /display/i }), { key: 'Enter' })
}

describe('Display menu — developer entry', () => {
  it('offers the diagnostics tab in a dev build', () => {
    mockIsDevMode = true
    openMenu()

    expect(screen.queryByText('I/O Image Diagnostics')).not.toBeNull()
  })

  it('opens the menu it is asserting on, so the negative below means something', () => {
    mockIsDevMode = false
    openMenu()

    // A guard on the guard: if the menu never opened, "the item is absent"
    // would pass for every build and this suite would prove nothing.
    expect(screen.queryByText('Change Theme')).not.toBeNull()
  })

  it('does not offer it in a production build', () => {
    mockIsDevMode = false
    openMenu()

    expect(screen.queryByText('I/O Image Diagnostics')).toBeNull()
  })
})
