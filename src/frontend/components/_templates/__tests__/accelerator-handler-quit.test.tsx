/**
 * Renderer side of the quit and refresh flows: main decides hide versus quit and asks for
 * the prompt; the renderer only shows it, and `beforeunload` only guards against unloads.
 */

import { act, render } from '@testing-library/react'
import type { ReactNode } from 'react'

import { EDITOR_CAPABILITIES } from '../../../../middleware/shared/ports/platform-capabilities'
import type { AcceleratorPort } from '../../../../middleware/shared/ports/accelerator-port'
import type { WindowPort } from '../../../../middleware/shared/ports/window-port'
import { PlatformProvider } from '../../../../middleware/shared/providers'
import type { PlatformPorts } from '../../../../middleware/shared/providers/types'
import { openPLCStoreBase } from '../../../store'
import { AcceleratorHandler } from '../accelerator-handler'

function stubPort<T extends object>(overrides: Partial<T> = {}): T {
  const target: T = Object.create(null)
  return new Proxy(target, {
    get: (_, prop) => {
      if (Reflect.has(overrides, prop)) return Reflect.get(overrides, prop)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

type Listener = () => void

const listeners: Record<'quitRequested' | 'closeRequested' | 'refresh', Listener | null> = {
  quitRequested: null,
  closeRequested: null,
  refresh: null,
}
const windowCalls: string[] = []

const subscribe = (key: keyof typeof listeners) => (cb: Listener) => {
  listeners[key] = cb
  return () => {
    if (listeners[key] === cb) listeners[key] = null
  }
}

function makePorts(): PlatformPorts {
  return {
    compiler: stubPort(),
    runtime: stubPort(),
    debugger: stubPort(),
    simulator: stubPort(),
    project: stubPort(),
    device: stubPort(),
    orchestrator: stubPort(),
    system: stubPort(),
    window: stubPort<WindowPort>({
      close: () => windowCalls.push('close'),
      hide: () => windowCalls.push('hide'),
      quit: () => windowCalls.push('quit'),
      requestQuit: () => windowCalls.push('requestQuit'),
      reload: () => windowCalls.push('reload'),
      onQuitRequested: subscribe('quitRequested'),
      onCloseRequested: subscribe('closeRequested'),
      enableAutoCloseHandshake: () => () => undefined,
    }),
    accelerator: stubPort<AcceleratorPort>({ onRefresh: subscribe('refresh') }),
    theme: stubPort(),
    versionControl: stubPort(),
    navigation: stubPort(),
    library: stubPort(),
    capabilities: EDITOR_CAPABILITIES,
  }
}

function Wrapper({ children }: { children: ReactNode }) {
  return <PlatformProvider ports={makePorts()}>{children}</PlatformProvider>
}

const initialState = openPLCStoreBase.getState()

function modal(name: 'quit-application' | 'save-changes-project') {
  return openPLCStoreBase.getState().modals[name]
}

function setOS(OS: 'darwin' | 'win32' | 'linux') {
  openPLCStoreBase.getState().workspaceActions.setSystemConfigs({ OS })
}

function setUnsaved() {
  act(() => openPLCStoreBase.getState().workspaceActions.setEditingState('unsaved'))
}

function fire(key: keyof typeof listeners) {
  const cb = listeners[key]
  if (!cb) throw new Error(`nothing subscribed to ${key}`)
  act(() => cb())
}

/** Returns whether the handler cancelled the unload. */
function dispatchBeforeUnload(): boolean {
  const event = new Event('beforeunload', { cancelable: true })
  act(() => {
    window.dispatchEvent(event)
  })
  return event.defaultPrevented
}

beforeEach(() => {
  openPLCStoreBase.setState(initialState, true)
  windowCalls.length = 0
  for (const key of Object.keys(listeners) as Array<keyof typeof listeners>) listeners[key] = null
})

describe('a quit prompt requested by main', () => {
  it.each(['darwin', 'win32'] as const)('%s: opens the quit confirmation when nothing is unsaved', (OS) => {
    setOS(OS)
    render(<AcceleratorHandler />, { wrapper: Wrapper })

    fire('quitRequested')

    expect(modal('quit-application').open).toBe(true)
    expect(modal('save-changes-project').open).toBe(false)
  })

  it.each(['darwin', 'win32'] as const)('%s: opens the save-changes prompt when the project is unsaved', (OS) => {
    setOS(OS)
    render(<AcceleratorHandler />, { wrapper: Wrapper })
    setUnsaved()

    fire('quitRequested')

    expect(modal('save-changes-project')).toEqual({ open: true, data: { validationContext: 'close-app' } })
    expect(modal('quit-application').open).toBe(false)
  })

  it('never hides, closes or quits on its own', () => {
    setOS('darwin')
    render(<AcceleratorHandler />, { wrapper: Wrapper })

    fire('quitRequested')

    expect(windowCalls).toEqual([])
  })

  it('stops listening once unmounted', () => {
    setOS('darwin')
    const { unmount } = render(<AcceleratorHandler />, { wrapper: Wrapper })
    expect(listeners.quitRequested).not.toBeNull()

    unmount()

    expect(listeners.quitRequested).toBeNull()
  })
})

describe('beforeunload on macOS', () => {
  beforeEach(() => setOS('darwin'))

  it.each([false, true])('blocks an uninvited unload (unsaved: %s)', (unsaved) => {
    render(<AcceleratorHandler />, { wrapper: Wrapper })
    if (unsaved) setUnsaved()

    expect(dispatchBeforeUnload()).toBe(true)
  })

  it('never hides, prompts or quits from beforeunload', () => {
    render(<AcceleratorHandler />, { wrapper: Wrapper })
    setUnsaved()

    dispatchBeforeUnload()

    expect(windowCalls).toEqual([])
    expect(modal('quit-application').open).toBe(false)
    expect(modal('save-changes-project').open).toBe(false)
  })

  it('does not act on a close notice (the red button is main’s job)', () => {
    render(<AcceleratorHandler />, { wrapper: Wrapper })
    fire('closeRequested')

    dispatchBeforeUnload()

    expect(windowCalls).not.toContain('hide')
    expect(modal('quit-application').open).toBe(false)
    expect(modal('save-changes-project').open).toBe(false)
  })
})

describe('beforeunload on Windows and Linux keeps its current behaviour', () => {
  it.each(['win32', 'linux'] as const)('%s: blocks an uninvited unload', (OS) => {
    setOS(OS)
    render(<AcceleratorHandler />, { wrapper: Wrapper })

    expect(dispatchBeforeUnload()).toBe(true)
    expect(modal('quit-application').open).toBe(false)
  })

  it.each(['win32', 'linux'] as const)('%s: a window close opens the quit confirmation', (OS) => {
    setOS(OS)
    render(<AcceleratorHandler />, { wrapper: Wrapper })
    fire('closeRequested')

    dispatchBeforeUnload()

    expect(modal('quit-application').open).toBe(true)
    expect(windowCalls).not.toContain('hide')
  })

  it.each(['win32', 'linux'] as const)('%s: a window close with unsaved changes opens save-changes', (OS) => {
    setOS(OS)
    render(<AcceleratorHandler />, { wrapper: Wrapper })
    setUnsaved()
    fire('closeRequested')

    dispatchBeforeUnload()

    expect(modal('save-changes-project')).toEqual({ open: true, data: { validationContext: 'close-app' } })
  })
})

/** Refresh reloads the whole app, so it goes through the same prompt as any other data loss. */
describe('the Refresh accelerator', () => {
  it.each(['darwin', 'win32', 'linux'] as const)('%s: reloads straight away when nothing is unsaved', (OS) => {
    setOS(OS)
    render(<AcceleratorHandler />, { wrapper: Wrapper })

    fire('refresh')

    expect(windowCalls).toEqual(['reload'])
    expect(modal('save-changes-project').open).toBe(false)
  })

  it.each(['darwin', 'win32', 'linux'] as const)('%s: asks to save first when the project is unsaved', (OS) => {
    setOS(OS)
    render(<AcceleratorHandler />, { wrapper: Wrapper })
    setUnsaved()

    fire('refresh')

    expect(modal('save-changes-project')).toEqual({ open: true, data: { validationContext: 'refresh-app' } })
    expect(windowCalls).toEqual([])
  })

  it('stops listening once unmounted', () => {
    const { unmount } = render(<AcceleratorHandler />, { wrapper: Wrapper })
    expect(listeners.refresh).not.toBeNull()

    unmount()

    expect(listeners.refresh).toBeNull()
  })
})
