import * as MenuPrimitive from '@radix-ui/react-menubar'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

import type { AppUpdatePort } from '@root/middleware/shared/ports/app-update-port'
import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { ThemePort } from '@root/middleware/shared/ports/theme-port'
import { PlatformProvider } from '@root/middleware/shared/providers'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'

import { createOpenPLCStore, type OpenPLCStore, OpenPLCStoreProvider } from '../../../../../store'
import { FileMenu } from '../file'

function stubPort<T extends object>(overrides: Partial<T> = {}): T {
  return new Proxy({} as T, {
    get: (_, prop) => {
      if (Reflect.has(overrides, prop)) return Reflect.get(overrides, prop)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

function makePorts(appUpdate?: AppUpdatePort): PlatformPorts {
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
    capabilities: EDITOR_CAPABILITIES,
    appUpdate,
  }
}

function fakeAppUpdate(autoCheck: boolean) {
  return {
    getStatus: jest.fn(() => Promise.resolve({ state: 'none' as const })),
    onStatusChanged: jest.fn(() => () => undefined),
    downloadAndOpen: jest.fn(),
    dismiss: jest.fn(),
    checkNow: jest.fn(),
    isAutoCheckEnabled: jest.fn(() => Promise.resolve(autoCheck)),
    setAutoCheck: jest.fn(),
  }
}

let store: OpenPLCStore

async function openMenu(appUpdate?: AppUpdatePort) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <OpenPLCStoreProvider store={store}>
      <PlatformProvider ports={makePorts(appUpdate)}>{children}</PlatformProvider>
    </OpenPLCStoreProvider>
  )
  render(
    <MenuPrimitive.Root>
      <FileMenu />
    </MenuPrimitive.Root>,
    { wrapper },
  )
  await act(() => Promise.resolve())
  fireEvent.keyDown(screen.getByRole('menuitem', { name: /file/i }), { key: 'Enter' })
}

describe('File menu — update items', () => {
  beforeEach(() => {
    store = createOpenPLCStore()
  })

  it('Check for Updates asks the update service', async () => {
    const appUpdate = fakeAppUpdate(true)
    await openMenu(appUpdate)

    fireEvent.click(screen.getByText('Check for Updates'))
    expect(appUpdate.checkNow).toHaveBeenCalledTimes(1)
  })

  it('shows the automatic check as the service has it and toggles it', async () => {
    const appUpdate = fakeAppUpdate(true)
    await openMenu(appUpdate)

    const toggle = screen.getByRole('menuitemcheckbox', { name: /Check for Updates Automatically/ })
    expect(toggle.getAttribute('aria-checked')).toBe('true')

    fireEvent.click(toggle)
    expect(appUpdate.setAutoCheck).toHaveBeenCalledWith(false)
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })

  it('without an update service, Check for Updates is disabled and there is no toggle', async () => {
    await openMenu()

    expect(screen.getByRole('menuitem', { name: 'Check for Updates' }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.queryByText('Check for Updates Automatically')).toBeNull()
  })
})
