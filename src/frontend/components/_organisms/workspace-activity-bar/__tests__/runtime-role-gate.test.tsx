/**
 * With an operator or viewer signed in to the runtime, upload, start/stop and the debugger are disabled, and each
 * says which role cannot use it. Engineering roles keep them.
 */
import type { OpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestPorts, createTestStore } from '@root/frontend/store/testing'
import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { RuntimeUserRole } from '@root/middleware/shared/ports/runtime-port'
import type { BoardInfo } from '@root/middleware/shared/ports/types'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { DefaultWorkspaceActivityBar } from '../default'

const RUNTIME_BOARD_NAME = 'OpenPLC Runtime v4'
const RUNTIME_BOARD: BoardInfo = { compiler: 'openplc-compiler', core: 'openplc', preview: 'generic.png', specs: {} }

let store: OpenPLCStore

function renderBar(role: RuntimeUserRole | null) {
  const { deviceActions, workspaceActions } = store.getState()
  deviceActions.setAvailableOptions({ availableBoards: new Map([[RUNTIME_BOARD_NAME, RUNTIME_BOARD]]) })
  deviceActions.setDeviceBoard(RUNTIME_BOARD_NAME)
  deviceActions.setRuntimeIpAddress('10.0.0.5')
  deviceActions.setRuntimeJwtToken('tok')
  deviceActions.setRuntimeConnectionStatus('connected')
  deviceActions.setRuntimeAccountRole(role)
  workspaceActions.setCanEdit(false)
  render(<DefaultWorkspaceActivityBar />, {
    wrapper: createStoreWrapper(store, createTestPorts({ capabilities: EDITOR_CAPABILITIES })),
  })
}

/** Hovers the wrapper an activity bar button's tooltip hangs on, and resolves the tooltip text. */
async function tooltipOf(name: string): Promise<string> {
  const button = screen.getByRole('button', { name })
  const trigger = button.parentElement
  if (!trigger) throw new Error(`no tooltip trigger for ${name}`)
  fireEvent.pointerMove(trigger)
  const tooltip = await screen.findByRole('tooltip', {}, { timeout: 3000 })
  return tooltip.textContent ?? ''
}

beforeEach(() => {
  store = createTestStore()
})

afterEach(() => {
  cleanup()
})

describe('engineering actions for HMI roles', () => {
  it.each<RuntimeUserRole>(['operator', 'viewer'])('%s: the debugger is disabled and names the role', async (role) => {
    renderBar(role)
    expect(screen.getByRole('button', { name: 'Debugger' })).toHaveProperty('disabled', true)
    expect(await tooltipOf('Debugger')).toContain(`Your role (${role}) can't use the debugger`)
  })

  it('operator: start/stop is disabled and names the role', async () => {
    renderBar('operator')
    expect(screen.getByRole('button', { name: 'Play' })).toHaveProperty('disabled', true)
    expect(await tooltipOf('Play')).toContain("Your role (operator) can't start or stop the PLC")
  })

  it('operator: the upload build options are disabled and name the role', async () => {
    renderBar('operator')
    fireEvent.click(screen.getByRole('button', { name: 'Build options' }))
    const upload = (await screen.findByText('Build and upload')).closest('button')
    expect(upload).toHaveProperty('disabled', true)
    const clean = screen.getByText('Clean build and upload').closest('button')
    expect(clean).toHaveProperty('disabled', true)
    expect(screen.getByText('Build only').closest('button')).toHaveProperty('disabled', false)
    const wrapper = upload?.parentElement
    if (!wrapper) throw new Error('no tooltip trigger for Build and upload')
    fireEvent.pointerMove(wrapper)
    const tooltip = await screen.findByRole('tooltip', {}, { timeout: 3000 })
    expect(tooltip.textContent).toContain("Your role (operator) can't upload programs")
  })

  it.each<RuntimeUserRole | null>(['admin', 'engineer', null])('%s keeps the debugger and upload', async (role) => {
    renderBar(role)
    expect(screen.getByRole('button', { name: 'Debugger' })).toHaveProperty('disabled', false)
    fireEvent.click(screen.getByRole('button', { name: 'Build options' }))
    expect((await screen.findByText('Build and upload')).closest('button')).toHaveProperty('disabled', false)
  })
})
