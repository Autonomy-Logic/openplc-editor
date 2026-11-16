/**
 * The developer diagnostics entry is absent from a production build.
 *
 * A desktop build has two menus and this is the React one, which rides in the
 * custom title bar. Its native counterpart is gated in `src/main/menu.ts`; the
 * two are tested separately because they are two different menus, and a gate on
 * one says nothing about the other.
 */

import * as MenuPrimitive from '@radix-ui/react-menubar'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { ThemePort } from '@root/middleware/shared/ports/theme-port'
import { PlatformProvider } from '@root/middleware/shared/providers'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'

import { createOpenPLCStore, type OpenPLCStore, OpenPLCStoreProvider } from '../../../../../store'
import { DisplayMenu } from '../display'

/** A port whose every method answers `undefined`, except the ones handed in. */
function stubPort<T extends object>(overrides: Partial<T> = {}): T {
  return new Proxy({} as T, {
    get: (_, prop) => {
      if (Reflect.has(overrides, prop)) return Reflect.get(overrides, prop)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

function makePorts(isDevMode: boolean): PlatformPorts {
  return {
    compiler: stubPort(),
    runtime: stubPort(),
    debugger: stubPort(),
    simulator: stubPort(),
    project: stubPort(),
    device: stubPort(),
    orchestrator: stubPort(),
    system: stubPort(),
    window: stubPort(),
    accelerator: stubPort(),
    theme: stubPort<ThemePort>({
      getCurrentTheme: () => 'light',
      onThemeChanged: () => () => undefined,
      setTheme: () => undefined,
    }),
    versionControl: stubPort(),
    navigation: stubPort(),
    library: stubPort(),
    capabilities: { ...EDITOR_CAPABILITIES, isDevMode },
  }
}

let store: OpenPLCStore

// Radix's trigger opens on Enter — driven with a keydown so the test needs no
// PointerEvent, whose jsdom support varies between the two repos' runners.
const openMenu = (isDevMode: boolean) => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <OpenPLCStoreProvider store={store}>
      <PlatformProvider ports={makePorts(isDevMode)}>{children}</PlatformProvider>
    </OpenPLCStoreProvider>
  )
  render(
    <MenuPrimitive.Root>
      <DisplayMenu />
    </MenuPrimitive.Root>,
    { wrapper },
  )
  fireEvent.keyDown(screen.getByRole('menuitem', { name: /display/i }), { key: 'Enter' })
}

describe('Display menu — developer entry', () => {
  beforeEach(() => {
    store = createOpenPLCStore()
  })

  it('offers the diagnostics tab in a dev build', () => {
    openMenu(true)

    expect(screen.queryByText('I/O Image Diagnostics')).not.toBeNull()
  })

  it('opens the menu it is asserting on, so the negative below means something', () => {
    openMenu(false)

    // A guard on the guard: if the menu never opened, "the item is absent"
    // would pass for every build and this suite would prove nothing.
    expect(screen.queryByText('Change Theme')).not.toBeNull()
  })

  it('does not offer it in a production build', () => {
    openMenu(false)

    expect(screen.queryByText('I/O Image Diagnostics')).toBeNull()
  })
})
