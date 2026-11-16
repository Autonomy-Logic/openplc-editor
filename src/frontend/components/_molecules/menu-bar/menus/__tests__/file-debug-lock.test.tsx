import * as MenuPrimitive from '@radix-ui/react-menubar'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { ThemePort } from '@root/middleware/shared/ports/theme-port'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'

import type { OpenPLCStore } from '../../../../../store'
import { createStoreWrapper, createTestStore } from '../../../../../store/testing'
import { FileMenu } from '../file'

function stubPort<T extends object>(overrides: Partial<T> = {}): T {
  return new Proxy({} as T, {
    get: (_, prop) => {
      if (Reflect.has(overrides, prop)) return Reflect.get(overrides, prop)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

const ports: PlatformPorts = {
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
  capabilities: EDITOR_CAPABILITIES,
}

let store: OpenPLCStore

const openDebugSession = () =>
  act(() => {
    store.getState().workspaceActions.setDebuggerVisible(true)
  })

const closeDebugSession = () =>
  act(() => {
    store.getState().workspaceActions.clearDebugState()
  })

const openMenu = async () => {
  const StoreWrapper = createStoreWrapper(store, ports)
  const wrapper = ({ children }: { children: ReactNode }) => <StoreWrapper>{children}</StoreWrapper>
  render(
    <MenuPrimitive.Root>
      <FileMenu />
    </MenuPrimitive.Root>,
    { wrapper },
  )
  await act(() => Promise.resolve())
  fireEvent.keyDown(screen.getByRole('menuitem', { name: /file/i }), { key: 'Enter' })
}

const importItem = () => screen.getByRole('menuitem', { name: /import plcopen xml/i })

const confirmationIsOpen = () => store.getState().modals['confirm-plcopen-import'].open

describe('the in-app File menu during a debug session (TC19)', () => {
  beforeEach(() => {
    store = createTestStore()
  })

  it('should offer Import from PLCopen XML while no debug session is open', async () => {
    await openMenu()

    expect(importItem().getAttribute('data-disabled')).toBeNull()
  })

  it('should show Import from PLCopen XML disabled while the debugger is open', async () => {
    openDebugSession()
    await openMenu()

    expect(importItem().getAttribute('data-disabled')).not.toBeNull()
  })

  it('should open no import confirmation when the disabled item is clicked', async () => {
    openDebugSession()
    await openMenu()

    fireEvent.click(importItem())

    expect(confirmationIsOpen()).toBe(false)
  })

  it('should open the import confirmation once the debug session is closed', async () => {
    openDebugSession()
    closeDebugSession()
    await openMenu()

    fireEvent.click(importItem())

    expect(confirmationIsOpen()).toBe(true)
  })
})
