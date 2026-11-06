import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import type { PackagePort } from '@root/middleware/shared/ports/package-port'
import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { act, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'

import type { OpenPLCStore } from '@root/frontend/store'
import {
  CreateDeviceEditor,
  CreateLibraryManagerEditor,
  CreatePackageManagerEditor,
  CreateRemoteDeviceEditor,
} from '@root/frontend/store/slices/tabs/utils'
import { DeviceEditor } from '../device'
import { RemoteDeviceEditor } from '../device/remote-device'
import { LibraryManagerEditor } from '../library-manager'
import { PackageManagerEditor } from '../package-manager'

/** A port whose every method answers `undefined`. */
function stubPort<T extends object>(overrides: Partial<T> = {}): T {
  return new Proxy(overrides as T, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver)
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
  theme: stubPort(),
  versionControl: stubPort(),
  navigation: stubPort(),
  library: stubPort(),
  packages: stubPort<PackagePort>({ listInstalled: () => Promise.resolve([]) }),
  capabilities: EDITOR_CAPABILITIES,
}

let store: OpenPLCStore
let container: HTMLElement

const renderEditor = (ui: ReactElement) => {
  container = render(ui, { wrapper: createStoreWrapper(store, ports) }).container
}

const openDebugSession = () =>
  act(() => {
    store.getState().workspaceActions.setDebuggerVisible(true)
  })

const closeDebugSession = () =>
  act(() => {
    store.getState().workspaceActions.clearDebugState()
  })

const controls = () =>
  Array.from(container.querySelectorAll<HTMLElement>('input, select, textarea, button')).filter(
    (control) => control.closest('[role="tablist"]') === null,
  )

const someControlIsLive = () => controls().some((control) => !control.matches(':disabled'))
const everyControlIsLocked = () => controls().every((control) => control.matches(':disabled'))

describe('library manager during a debug session (TC11)', () => {
  beforeEach(() => {
    store = createTestStore()
    store.getState().editorActions.setEditor(CreateLibraryManagerEditor())
    renderEditor(<LibraryManagerEditor />)
  })

  it('should leave at least one action live while no debug session is open', () => {
    expect(controls().length).toBeGreaterThan(0)
    expect(someControlIsLive()).toBe(true)
  })

  it('should lock every action while the debugger is open', () => {
    openDebugSession()

    expect(controls().length).toBeGreaterThan(0)
    expect(everyControlIsLocked()).toBe(true)
  })

  it('should release the actions once the debug session is closed', () => {
    openDebugSession()
    closeDebugSession()

    expect(someControlIsLive()).toBe(true)
  })
})

describe('device configuration during a debug session (TC11)', () => {
  beforeEach(() => {
    store = createTestStore()
    store.getState().editorActions.setEditor(CreateDeviceEditor('device', 'configuration'))
    renderEditor(<DeviceEditor />)
  })

  it('should leave at least one control live while no debug session is open', () => {
    expect(controls().length).toBeGreaterThan(0)
    expect(someControlIsLive()).toBe(true)
  })

  it('should lock every control while the debugger is open', () => {
    openDebugSession()

    expect(controls().length).toBeGreaterThan(0)
    expect(everyControlIsLocked()).toBe(true)
  })

  it('should release the controls once the debug session is closed', () => {
    openDebugSession()
    closeDebugSession()

    expect(someControlIsLive()).toBe(true)
  })
})

describe('pin mapping during a debug session (TC11)', () => {
  beforeEach(() => {
    store = createTestStore()
    store.getState().editorActions.setEditor(CreateDeviceEditor('device', 'pin-mapping'))
    renderEditor(<DeviceEditor />)
  })

  it('should lock every control while the debugger is open', () => {
    openDebugSession()

    expect(controls().length).toBeGreaterThan(0)
    expect(everyControlIsLocked()).toBe(true)
  })
})

describe('remote device editor during a debug session (TC11)', () => {
  beforeEach(() => {
    store = createTestStore()
    expect(
      store.getState().projectActions.createRemoteDevice({ data: { name: 'RD1', protocol: 'modbus-tcp' } }).ok,
    ).toBe(true)
    store.getState().editorActions.setEditor(CreateRemoteDeviceEditor('RD1', 'modbus-tcp'))
    renderEditor(<RemoteDeviceEditor />)
  })

  it('should leave at least one control live while no debug session is open', () => {
    expect(controls().length).toBeGreaterThan(0)
    expect(someControlIsLive()).toBe(true)
  })

  it('should lock every control while the debugger is open', () => {
    openDebugSession()

    expect(controls().length).toBeGreaterThan(0)
    expect(everyControlIsLocked()).toBe(true)
  })
})

describe('package manager during a debug session (TC11)', () => {
  beforeEach(() => {
    store = createTestStore()
    store.getState().editorActions.setEditor(CreatePackageManagerEditor())
    renderEditor(<PackageManagerEditor />)
  })

  it('should lock every action while the debugger is open', () => {
    openDebugSession()

    expect(controls().length).toBeGreaterThan(0)
    expect(everyControlIsLocked()).toBe(true)
  })
})

describe('the tab strips stay usable while the debugger is open (BR03)', () => {
  it('should leave the library manager tabs enabled', () => {
    store = createTestStore()
    store.getState().editorActions.setEditor(CreateLibraryManagerEditor())
    renderEditor(<LibraryManagerEditor />)

    openDebugSession()

    const tabs = screen.getAllByRole<HTMLButtonElement>('tab')
    expect(tabs.length).toBeGreaterThan(0)
    expect(tabs.every((tab) => !tab.matches(':disabled'))).toBe(true)
  })
})
