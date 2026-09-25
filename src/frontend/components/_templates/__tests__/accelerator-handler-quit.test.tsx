/**
 * Renderer side of the quit flow: main decides hide versus quit and asks for the
 * prompt; the renderer only shows it, and `beforeunload` no longer decides on macOS.
 */

import { act, render } from '@testing-library/react'
import type { ReactNode } from 'react'

import { EDITOR_CAPABILITIES } from '../../../../middleware/shared/ports/platform-capabilities'
import type { WindowPort } from '../../../../middleware/shared/ports/window-port'
import { PlatformProvider } from '../../../../middleware/shared/providers'
import type { PlatformPorts } from '../../../../middleware/shared/providers/types'
import { openPLCStoreBase } from '../../../store'
import { AcceleratorHandler } from '../accelerator-handler'

function stubPort<T extends object>(overrides: Partial<T> = {}): T {
  return new Proxy({} as T, {
    get: (_, prop) => {
      if (Reflect.has(overrides, prop)) return Reflect.get(overrides, prop)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

type Listener = () => void

const listeners: Record<'quitRequested' | 'closeRequested' | 'darwinQuitting', Listener | null> = {
  quitRequested: null,
  closeRequested: null,
  darwinQuitting: null,
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
      onQuitRequested: subscribe('quitRequested'),
      onCloseRequested: subscribe('closeRequested'),
      onDarwinAppQuitting: subscribe('darwinQuitting'),
      enableAutoCloseHandshake: () => () => undefined,
    }),
    accelerator: stubPort(),
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

/** Legacy main-to-renderer notices: fired only if the handler still listens to them. */
function fireIfSubscribed(key: keyof typeof listeners) {
  const cb = listeners[key]
  if (cb) act(() => cb())
}

function dispatchBeforeUnload() {
  act(() => {
    window.dispatchEvent(new Event('beforeunload'))
  })
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

  it('does not hide the window after a close notice (the red button is main’s job)', () => {
    render(<AcceleratorHandler />, { wrapper: Wrapper })
    fireIfSubscribed('closeRequested')

    dispatchBeforeUnload()

    expect(windowCalls).not.toContain('hide')
    expect(modal('quit-application').open).toBe(false)
    expect(modal('save-changes-project').open).toBe(false)
  })

  it('does not open a quit prompt after a cancelled quit', () => {
    render(<AcceleratorHandler />, { wrapper: Wrapper })
    fireIfSubscribed('darwinQuitting')
    fireIfSubscribed('closeRequested')

    dispatchBeforeUnload()

    expect(modal('quit-application').open).toBe(false)
    expect(windowCalls).not.toContain('hide')
  })

  it('does not open the save-changes prompt either', () => {
    render(<AcceleratorHandler />, { wrapper: Wrapper })
    setUnsaved()
    fireIfSubscribed('darwinQuitting')
    fireIfSubscribed('closeRequested')

    dispatchBeforeUnload()

    expect(modal('save-changes-project').open).toBe(false)
  })
})

describe('beforeunload on Windows and Linux keeps its current behaviour', () => {
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
