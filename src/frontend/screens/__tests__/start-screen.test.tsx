/**
 * The start screen's side menu. The Tutorials entry that used to sit here did
 * nothing when clicked; Documentation replaces it and has to actually go
 * somewhere, through the system port rather than a bare `window.open`, since
 * the desktop hands links to the OS shell and the web to a new tab.
 *
 * Driven through `PlatformProvider` with stub ports and the real store, so the
 * file runs unchanged under jest and vitest.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'

import type { DevicePort } from '../../../middleware/shared/ports/device-port'
import { EDITOR_CAPABILITIES } from '../../../middleware/shared/ports/platform-capabilities'
import type { ProjectPort } from '../../../middleware/shared/ports/project-port'
import type { SystemPort } from '../../../middleware/shared/ports/system-port'
import type { WindowPort } from '../../../middleware/shared/ports/window-port'
import { PlatformProvider } from '../../../middleware/shared/providers'
import type { PlatformPorts } from '../../../middleware/shared/providers/types'
import { StartScreen } from '../start-screen'

/** A port whose every method answers `undefined`, except the ones handed in. */
function stubPort<T extends object>(overrides: Partial<T> = {}): T {
  return new Proxy({} as T, {
    get: (_, prop) => {
      if (Reflect.has(overrides, prop)) return Reflect.get(overrides, prop)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

/** Every URL the screen asked the platform to open, in order. */
const openedLinks: string[] = []
/** How many times the local folder picker was asked for. */
let localOpens = 0
/** Every WindowPort call the screen made, in order. */
const windowCalls: string[] = []

let projectOverrides: Partial<ProjectPort> = {}

function makePorts(): PlatformPorts {
  return {
    compiler: stubPort(),
    runtime: stubPort(),
    debugger: stubPort(),
    simulator: stubPort(),
    // The screen reads both lists on mount. The stub's `undefined` would be sorted as the
    // recent list, and the cloud section would `.catch` on it; `unavailable` hides that section.
    project: stubPort<ProjectPort>({
      getRecentProjects: () => Promise.resolve([]),
      listRecentCloudProjects: () => Promise.resolve({ status: 'unavailable' }),
      openProject: () => {
        localOpens += 1
        return Promise.resolve({ success: false })
      },
      ...projectOverrides,
    }),
    device: stubPort<DevicePort>({ getCommunicationPorts: () => Promise.resolve([]) }),
    orchestrator: stubPort(),
    system: stubPort<SystemPort>({
      openExternalLink: (url: string) => {
        openedLinks.push(url)
        return Promise.resolve({ success: true })
      },
    }),
    window: stubPort<WindowPort>({
      close: () => windowCalls.push('close'),
      hide: () => windowCalls.push('hide'),
      quit: () => windowCalls.push('quit'),
      requestQuit: () => windowCalls.push('requestQuit'),
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

beforeEach(() => {
  openedLinks.length = 0
  windowCalls.length = 0
  localOpens = 0
  projectOverrides = {}
})

describe('the Documentation entry', () => {
  it('opens the Edge docs through the platform, not the browser', async () => {
    render(<StartScreen />, { wrapper: Wrapper })

    await userEvent.click(await screen.findByRole('button', { name: /documentation/i }))

    expect(openedLinks).toEqual(['https://edge.autonomylogic.com/docs'])
  })

  it('sits with the project actions, above the account', async () => {
    render(<StartScreen />, { wrapper: Wrapper })

    const labels = (await screen.findAllByRole('button')).map((button) => button.textContent?.trim() ?? '')

    // Order is part of the design: New Project, Open, Documentation, then whatever the account renders.
    // Matched, not equalled: an icon's `<title>` leaks into `textContent` ("Plus Icon New Project").
    expect(labels[0]).toMatch(/New Project$/)
    expect(labels[1]).toMatch(/Open$/)
    expect(labels[2]).toMatch(/Documentation$/)
  })
})

/**
 * Open used to go straight to the local folder picker. It now asks which world
 * first, because a signed-in user's projects may live on Edge, filed in folders
 * the start screen's "five most recent" never shows.
 */
describe('the Open entry', () => {
  it('offers the local picker and the Edge browser', async () => {
    render(<StartScreen />, { wrapper: Wrapper })

    await userEvent.click(await screen.findByRole('button', { name: /^open$/i }))

    expect(await screen.findByRole('menuitem', { name: /local project/i })).not.toBeNull()
    expect(await screen.findByRole('menuitem', { name: /autonomy edge project/i })).not.toBeNull()
  })

  it('keeps the local choice on the flow it always had', async () => {
    render(<StartScreen />, { wrapper: Wrapper })

    await userEvent.click(await screen.findByRole('button', { name: /^open$/i }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /local project/i }))

    expect(localOpens).toBe(1)
  })

  it('greys out the Edge choice on a build with no cloud channel', async () => {
    // `undefined` on purpose: the stub would otherwise answer every name with a function.
    projectOverrides = { listCloudFolders: undefined, listCloudProjectsInFolder: undefined }
    render(<StartScreen />, { wrapper: Wrapper })

    await userEvent.click(await screen.findByRole('button', { name: /^open$/i }))

    const edge = await screen.findByRole('menuitem', { name: /autonomy edge project/i })
    expect(edge.getAttribute('aria-disabled')).toBe('true')
  })
})

/** Exit is a quit, same as Cmd+Q: it asks main for the prompt and never closes or hides the window. */
describe('the Exit entry', () => {
  it('requests a quit', async () => {
    render(<StartScreen />, { wrapper: Wrapper })

    await userEvent.click(await screen.findByRole('button', { name: /exit/i }))

    expect(windowCalls).toEqual(['requestQuit'])
  })

  it('requests a quit on every click', async () => {
    render(<StartScreen />, { wrapper: Wrapper })
    const exit = await screen.findByRole('button', { name: /exit/i })

    await userEvent.click(exit)
    await userEvent.click(exit)

    expect(windowCalls).toEqual(['requestQuit', 'requestQuit'])
  })
})
