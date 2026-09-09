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
 * Rendered against a mocked port and store: the real screen needs an Edge
 * account, a registered Device and an agent, none of which make a useful
 * regression test for a set of strings.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const listOrchestrators = vi.fn()

/** Typed so the store's action spies can be read back without a cast. */
type MockStore = {
  runtimeConnection: Record<string, unknown>
  deviceActions: Record<string, ReturnType<typeof vi.fn>>
  modalActions: Record<string, ReturnType<typeof vi.fn>>
  deviceDefinitions: Record<string, unknown>
  deviceAvailableOptions: Record<string, unknown>
}

let storeState: MockStore

vi.mock('@root/middleware/shared/providers', () => ({
  useOrchestrator: () => ({ listOrchestrators }),
  useRuntime: () => ({
    getUsersInfo: vi.fn().mockResolvedValue({ error: 'not connected' }),
    setDeviceContext: vi.fn(),
    clearCredentials: vi.fn(),
  }),
}))

// Mocked through the @root alias rather than a relative path: Jest resolves a
// mock path relative to its setup file, not the test, so a relative one fails
// there while working under Vitest. The alias resolves to the same module in
// both, which keeps this file identical across the two apps.
vi.mock('@root/frontend/store', () => {
  // The screen reads the store both ways: destructured for the actions, and
  // with a selector for the simulator check.
  const useOpenPLCStore = (selector?: (state: unknown) => unknown) => (selector ? selector(storeState) : storeState)
  useOpenPLCStore.getState = () => storeState
  return { useOpenPLCStore }
})

// Whether the board is the in-process simulator is decided by board metadata
// this screen only passes through, and it has its own tests.
vi.mock('@root/middleware/shared/utils/target-capabilities', () => ({
  resolveTargetCapabilities: () => ({ isInProcessSimulator: true }),
}))

import { OrchestratorsList } from '../orchestrators-list'

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

const freshStore = (runtimeConnection: Record<string, unknown> = {}): MockStore => ({
  runtimeConnection: {
    connectionStatus: 'disconnected',
    selectedDevice: null,
    jwtToken: null,
    plcStatus: null,
    ...runtimeConnection,
  },
  deviceActions: {
    setDeviceBoard: vi.fn(),
    setSelectedDevice: vi.fn(),
    setRuntimeConnectionStatus: vi.fn(),
    setRuntimeVersion: vi.fn(),
    clearRuntimeConnection: vi.fn(),
  },
  modalActions: { openModal: vi.fn() },
  deviceDefinitions: { configuration: { deviceBoard: 'OpenPLC Simulator' } },
  deviceAvailableOptions: { availableBoards: new Map() },
})

beforeEach(() => {
  vi.clearAllMocks()
  storeState = freshStore()
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
    storeState = freshStore({
      connectionStatus: 'connected',
      jwtToken: 'jwt',
      selectedDevice: {
        orchestratorId: 'edge-1',
        orchestratorAgentId: 'agent-1',
        deviceId: 'vplc-1',
        deviceName: 'mixer',
      },
    })
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
