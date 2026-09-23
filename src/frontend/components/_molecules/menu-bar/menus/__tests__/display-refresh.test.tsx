/**
 * Display ▸ Refresh, which used to be a bare `window.location.reload()`.
 *
 * A reload throws the renderer's store away, so unsaved work goes with it — the
 * same cost as closing, which has always prompted. This menu did not, and on the
 * desktop it also skipped the main-process teardown, leaving the simulator
 * session up and the AI streams generating and billing an answer nobody would see.
 *
 * Driven through `PlatformProvider` with a fake window port and the real store,
 * so the file runs unchanged under both runners.
 */

import * as MenuPrimitive from '@radix-ui/react-menubar'
import { beforeEach, describe, expect, it } from '@jest/globals'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'

import { EDITOR_CAPABILITIES } from '../../../../../../middleware/shared/ports/platform-capabilities'
import type { WindowPort } from '../../../../../../middleware/shared/ports/window-port'
import { PlatformProvider } from '../../../../../../middleware/shared/providers'
import type { PlatformPorts } from '../../../../../../middleware/shared/providers/types'
import { openPLCStoreBase } from '../../../../../store'
import { DisplayMenu } from '../display'

/** A port whose every method answers `undefined` — for the ports nothing here reads. */
function stubPort<T extends object>(): T {
  return new Proxy({} as T, {
    get: (_, prop) => (typeof prop === 'string' ? () => undefined : undefined),
  })
}

let reloadCalls = 0

const windowPort: WindowPort = {
  ...stubPort<WindowPort>(),
  reload: () => {
    reloadCalls += 1
  },
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
    window: windowPort,
    accelerator: stubPort(),
    theme: stubPort(),
    versionControl: stubPort(),
    navigation: stubPort(),
    library: stubPort(),
    capabilities: EDITOR_CAPABILITIES,
  }
}

/** `MenubarMenu` reads the menubar context, so the root has to be there. */
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <PlatformProvider ports={makePorts()}>
      <MenuPrimitive.Root>{children}</MenuPrimitive.Root>
    </PlatformProvider>
  )
}

/** Radix menubar renders the item only once the menu is open. */
async function openRefreshMenu() {
  render(<DisplayMenu />, { wrapper: Wrapper })
  await userEvent.click(screen.getByRole('menuitem', { name: /display/i }))
}

beforeEach(() => {
  reloadCalls = 0
  openPLCStoreBase.getState().workspaceActions.setEditingState('saved')
  openPLCStoreBase.getState().modalActions.closeModal()
})

describe('with nothing unsaved', () => {
  it('reloads through the port rather than the browser', async () => {
    await openRefreshMenu()

    await userEvent.click(await screen.findByText('Refresh'))

    expect(reloadCalls).toBe(1)
    expect(openPLCStoreBase.getState().modals['save-changes-project']?.open).not.toBe(true)
  })
})

describe('with unsaved work', () => {
  beforeEach(() => {
    openPLCStoreBase.getState().workspaceActions.setEditingState('unsaved')
  })

  it('asks before throwing it away, and does not reload behind the dialog', async () => {
    await openRefreshMenu()

    await userEvent.click(await screen.findByText('Refresh'))

    const modal = openPLCStoreBase.getState().modals['save-changes-project']
    expect(modal?.open).toBe(true)
    expect(modal?.data).toEqual({ validationContext: 'reload-window' })
    expect(reloadCalls).toBe(0)
  })
})
