/**
 * Edge Devices screen — the vocabulary this screen displays (EDGE-639/640).
 *
 * This screen carries most of the copy the terminology rename changes, and it
 * had no test at all, so the acceptance criteria for it were something a person
 * had to remember to look at. What is pinned here is only the wording, and
 * deliberately: which noun each string uses is a product decision that was made
 * from what the code does, and it is the kind of decision a later refactor
 * silently undoes.
 *
 * The two nouns are not interchangeable. The list holds Edge Devices, the
 * platform entity; the rows under each one are vPLCs, the containers running on
 * it. Both words appear on this screen and swapping them is the specific
 * mistake this file exists to catch. The parent strings come from
 * `orchestrators.length` and from the catch around `listOrchestrators()`; the
 * child strings come from `orchestrator.devices` and from the row click.
 *
 * Rendered against stub ports and a fresh store: the real screen needs an Edge
 * account, a registered Device and an agent, none of which make a useful
 * regression test for a set of strings.
 */

import type { OpenPLCStore } from '@root/frontend/store'
import type { SelectedDevice } from '@root/frontend/store/slices/device/types'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import type { OrchestratorPort } from '@root/middleware/shared/ports/orchestrator-port'
import { WEB_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { RuntimePort } from '@root/middleware/shared/ports/runtime-port'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { render as rtlRender, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'

// Whether the board is the in-process simulator is decided by board metadata
// this screen only passes through, and it has its own tests.
vi.mock('@root/middleware/shared/utils/target-capabilities', () => ({
  resolveTargetCapabilities: () => ({ isInProcessSimulator: true }),
}))

import { OrchestratorsList } from '../orchestrators-list'

function stubPort<T extends object>(overrides: Partial<T> = {}): T {
  return new Proxy(overrides as T, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

const listOrchestrators = vi.fn()

// No package port: these are string tests, and the board rules stay inert
// without one, which is the same answer the desktop gives.
const ports: PlatformPorts = {
  compiler: stubPort(),
  runtime: stubPort<RuntimePort>({
    getUsersInfo: () => Promise.resolve({ hasUsers: false, error: 'not connected' }),
    setDeviceContext: () => undefined,
    clearCredentials: () => Promise.resolve({ success: true }),
  }),
  debugger: stubPort(),
  simulator: stubPort(),
  project: stubPort(),
  device: stubPort(),
  orchestrator: stubPort<OrchestratorPort>({ listOrchestrators }),
  system: stubPort(),
  window: stubPort(),
  accelerator: stubPort(),
  theme: stubPort(),
  versionControl: stubPort(),
  navigation: stubPort(),
  library: stubPort(),
  capabilities: WEB_CAPABILITIES,
}

let store: OpenPLCStore

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: createStoreWrapper(store, ports) })

/** One Edge Device carrying two vPLCs. */
const edgeDevice = {
  id: 'edge-1',
  agentId: 'agent-1',
  name: 'shop-floor-01',
  description: 'Line 1 cabinet',
  devices: [
    { id: 'vplc-1', name: 'mixer', status: 'online', active: true },
    { id: 'vplc-2', name: 'conveyor', status: 'offline', active: true },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  store = createTestStore()
  store.getState().deviceActions.setDeviceBoard('OpenPLC Simulator')
  listOrchestrators.mockResolvedValue([])
})

/**
 * The whole screen as text. Used for the sweep at the foot of this file: the
 * point there is that the old vocabulary is absent, which is a statement about
 * everything rendered rather than about one node.
 */
const visibleText = () => document.body.textContent ?? ''

describe('the strings that name the parent entity', () => {
  it('titles the screen Edge Devices', async () => {
    render(<OrchestratorsList />)
    await waitFor(() => expect(screen.getByText('Edge Devices')).toBeTruthy())
  })

  it('says what to select, naming the vPLC and where it lives', async () => {
    render(<OrchestratorsList />)
    await waitFor(() => expect(screen.getByText('Select a vPLC from your Edge Devices to connect to.')).toBeTruthy())
  })

  it('labels the refresh control for a screen reader', async () => {
    render(<OrchestratorsList />)
    await waitFor(() => expect(screen.getByLabelText('Refresh Edge Devices')).toBeTruthy())
  })

  it('says what it is loading before the list arrives', () => {
    // Never resolves, so the loading branch is the one on screen.
    listOrchestrators.mockReturnValue(new Promise(() => {}))
    render(<OrchestratorsList />)
    expect(screen.getByText('Loading Edge Devices...')).toBeTruthy()
  })

  it('names the parent in the empty state, which fires on an empty list', async () => {
    // The empty state is `orchestrators.length === 0`, so it describes the
    // parent list and not the vPLCs under it.
    listOrchestrators.mockResolvedValue([])
    render(<OrchestratorsList />)
    await waitFor(() => expect(screen.getByText('No Edge Devices found.')).toBeTruthy())
    expect(screen.getByText('Register an Edge Device in the Autonomy Edge platform to see it here.')).toBeTruthy()
  })

  it('names the parent when the list fails to load', async () => {
    // Set in the catch around `listOrchestrators()`, so this too is about the
    // parent list rather than about any vPLC.
    listOrchestrators.mockRejectedValue(new Error('edge unreachable'))
    render(<OrchestratorsList />)
    await waitFor(() => expect(screen.getByText('Failed to load Edge Devices. Please try again.')).toBeTruthy())
  })
})

describe('the strings that name the child entity', () => {
  it('counts the children of an Edge Device as vPLCs', async () => {
    listOrchestrators.mockResolvedValue([edgeDevice])
    render(<OrchestratorsList />)
    // Reads `orchestrator.devices.length`, which is the vPLC count.
    await waitFor(() => expect(screen.getByText('2 vPLCs')).toBeTruthy())
  })

  it('uses the singular for an Edge Device with one vPLC', async () => {
    listOrchestrators.mockResolvedValue([{ ...edgeDevice, devices: [edgeDevice.devices[0]] }])
    render(<OrchestratorsList />)
    await waitFor(() => expect(screen.getByText('1 vPLC')).toBeTruthy())
  })

  it('names the vPLC in the switch confirmation, which is reached from a child row', async () => {
    // Connected to one vPLC, then a different one is clicked: the only path to
    // this modal, and the reason its wording is vPLC and not Device.
    const connected: SelectedDevice = {
      orchestratorId: 'edge-1',
      orchestratorAgentId: 'agent-1',
      deviceId: 'vplc-1',
      deviceName: 'mixer',
    }
    const { deviceActions } = store.getState()
    deviceActions.setSelectedDevice(connected)
    deviceActions.setRuntimeJwtToken('jwt')
    deviceActions.setRuntimeConnectionStatus('connected')
    listOrchestrators.mockResolvedValue([edgeDevice])
    render(<OrchestratorsList />)

    await waitFor(() => expect(screen.getByText('2 vPLCs')).toBeTruthy())
    await userEvent.click(screen.getByText('conveyor'))

    await waitFor(() => expect(screen.getByText('Switch vPLC')).toBeTruthy())
    expect(screen.getByText(/you must disconnect from the current vPLC first\./)).toBeTruthy()
  })
})

describe('the old vocabulary', () => {
  // One assertion per state the screen can be in, because a leftover string
  // would sit in whichever branch was not re-read.
  it.each([
    ['an empty list', () => listOrchestrators.mockResolvedValue([])],
    ['a populated list', () => listOrchestrators.mockResolvedValue([edgeDevice])],
    ['a failed load', () => listOrchestrators.mockRejectedValue(new Error('edge unreachable'))],
  ])('is absent with %s', async (_name, arrange) => {
    arrange()
    render(<OrchestratorsList />)
    // Waits for the fetch to settle, so this reads the resolved state rather
    // than the loading one.
    await waitFor(() => expect(screen.queryByText('Loading Edge Devices...')).toBeNull())
    expect(visibleText()).not.toMatch(/orchestrator/i)
  })

  it('is absent from the accessible labels too', async () => {
    listOrchestrators.mockResolvedValue([edgeDevice])
    render(<OrchestratorsList />)
    await waitFor(() => expect(screen.getByText('2 vPLCs')).toBeTruthy())
    const labelled = Array.from(document.querySelectorAll('[aria-label]')).map(
      (el) => el.getAttribute('aria-label') ?? '',
    )
    expect(labelled.length).toBeGreaterThan(0)
    for (const label of labelled) expect(label).not.toMatch(/orchestrator/i)
  })
})
