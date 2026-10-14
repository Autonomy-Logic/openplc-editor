/**
 * Retrieve Project from PLC — the branching, not the presentation.
 *
 * This is the part of the flow every bug reported against it lived in: whether
 * the open project is replaced before or after the new one is known to be
 * openable, and what happens to a fetched project when the save-changes dialog
 * gets in the way. All three of those shipped broken at least once, and none of
 * them were pinned by anything.
 *
 * Rendered against a stubbed runtime port and a real store rather than a device: what
 * needs proving is the decision, and a device adds nothing to it.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { OpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import { getMemoryState } from '@root/frontend/utils/toast'
import type { FetchedProject, RetrievableDevice, RuntimePort } from '@root/middleware/shared/ports'
import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'

import { RetrieveProjectModal } from '../retrieve-project-modal'

function stubPort<T extends object>(overrides: Partial<T> = {}): T {
  return new Proxy(overrides as T, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

const listRetrievableDevices = vi.fn()
const fetchRetrievableProject = vi.fn()
const openFetchedProject = vi.fn()
const selectRetrievableDevice = vi.fn()
const installRetrievedLibraries = vi.fn()
const login = vi.fn()

/** The device the picker offers, already holding a project, already connected —
 *  so Continue goes straight to retrieving and no credentials are involved. */
const DEVICE: RetrievableDevice = {
  key: 'dev-1',
  name: '192.168.2.4',
  projectName: 'Irrigation Controller',
  answeredScan: true,
}

const FETCHED: FetchedProject = { projectName: 'Irrigation Controller', payload: '/scratch/irrigation' }

// One stable object, not a fresh literal per call: the picker's scan effect
// lists the port in its dependencies, so a new identity on every render would
// restart the scan on every render.
const runtimePort = stubPort<RuntimePort>({
  listRetrievableDevices,
  fetchRetrievableProject,
  openFetchedProject,
  selectRetrievableDevice,
  installRetrievedLibraries,
  login,
  connectedRetrievableDeviceKey: () => 'dev-1',
})

const ports: PlatformPorts = {
  compiler: stubPort(),
  runtime: runtimePort,
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
  capabilities: EDITOR_CAPABILITIES,
}

/** Spies for everything the picker can do to the workspace. */
let hasUnsavedChanges = vi.fn()
let openModal = vi.fn()
let closeProjectSpy = vi.fn()

/** Store state is frozen by Immer, so the spies are swapped in rather than installed with `spyOn`. */
function installSpies(target: OpenPLCStore) {
  const { modalActions, sharedWorkspaceActions } = target.getState()
  hasUnsavedChanges = vi.fn().mockReturnValue(false)
  openModal = vi.fn()
  closeProjectSpy = vi.fn(() => sharedWorkspaceActions.closeProject())
  target.setState({
    modalActions: { ...modalActions, openModal },
    sharedWorkspaceActions: {
      ...sharedWorkspaceActions,
      hasUnsavedChanges: () => hasUnsavedChanges(),
      closeProject: closeProjectSpy,
    },
  })
}

let store: OpenPLCStore

const toastTitles = () => getMemoryState().toasts.map((t) => t.title)

/** Pick the device and press Continue — the point every scenario starts from. */
async function continueWithDevice() {
  render(<RetrieveProjectModal />, { wrapper: createStoreWrapper(store, ports) })
  await waitFor(() => expect(screen.getByText('Irrigation Controller')).toBeTruthy())
  fireEvent.click(screen.getByText('Irrigation Controller'))
  fireEvent.click(screen.getByText('Continue'))
}

beforeEach(() => {
  // The port spies are module-level, so their call counts would otherwise carry
  // from one test into the next -- and "was this opened?" is the assertion most
  // of these make.
  vi.clearAllMocks()
  store = createTestStore()
  store.getState().modalActions.openModal('retrieve-project', null)
  installSpies(store)
  listRetrievableDevices.mockResolvedValue({ success: true, devices: [DEVICE] })
  fetchRetrievableProject.mockResolvedValue({ success: true, project: FETCHED })
  openFetchedProject.mockResolvedValue({ success: true })
  installRetrievedLibraries.mockResolvedValue({ success: true, installed: [], failed: [] })
  getMemoryState().toasts.length = 0
})

describe('a project with nothing unsaved', () => {
  it('opens the fetched project without asking anything', async () => {
    await continueWithDevice()

    await waitFor(() => expect(openFetchedProject).toHaveBeenCalledWith(FETCHED))
    expect(openModal).not.toHaveBeenCalled()
    expect(toastTitles()).toContain('Retrieved "Irrigation Controller"')
  })

  it('does not tear the workspace down before the new project is open', async () => {
    // The teardown belongs to `handleOpenProjectResponse`, on the far side of a
    // successful open. Doing it here first meant a failed open left the user on
    // the start screen with their own project gone and nothing in its place.
    await continueWithDevice()

    await waitFor(() => expect(openFetchedProject).toHaveBeenCalled())
    expect(closeProjectSpy).not.toHaveBeenCalled()
  })

  it('reports a rejected open rather than letting it escape', async () => {
    // Behind a port, so a platform may throw instead of answering — and both
    // callers reach `completeRetrieve` through `void`, so an escaping rejection
    // would be unhandled and silent.
    openFetchedProject.mockRejectedValue(new Error('the bridge is gone'))

    await continueWithDevice()

    await waitFor(() => expect(toastTitles()).toContain('The retrieved project could not be opened'))
    expect(closeProjectSpy).not.toHaveBeenCalled()
  })

  it('keeps the success when only the libraries fail', async () => {
    // The project is open by this point; a library failure is not a failed
    // retrieve and must not read as one.
    installRetrievedLibraries.mockRejectedValue(new Error('registry unreachable'))

    await continueWithDevice()

    await waitFor(() => expect(toastTitles()).toContain('Retrieved "Irrigation Controller"'))
  })

  it('reports a failed open and leaves the workspace alone', async () => {
    openFetchedProject.mockResolvedValue({ success: false, error: 'The archive is unreadable' })

    await continueWithDevice()

    await waitFor(() => expect(toastTitles()).toContain('The retrieved project could not be opened'))
    expect(closeProjectSpy).not.toHaveBeenCalled()
    expect(toastTitles()).not.toContain('Retrieved "Irrigation Controller"')
  })
})

describe('a project with unsaved changes', () => {
  beforeEach(() => {
    hasUnsavedChanges.mockReturnValue(true)
  })

  it('asks about the unsaved work under its own context, after fetching', async () => {
    await continueWithDevice()

    await waitFor(() => expect(openModal).toHaveBeenCalled())
    // Fetched first: a device that turns out to have nothing must not cost
    // anyone their open project.
    expect(fetchRetrievableProject).toHaveBeenCalled()
    const [modal, data] = openModal.mock.calls[0]
    expect(modal).toBe('save-changes-project')
    // NOT 'close-project', whose branch clears the workspace and returns to the
    // host: both of its buttons ended the retrieve there.
    expect((data as { validationContext: string }).validationContext).toBe('retrieve-project')
    // Nothing is opened until the dialog answers.
    expect(openFetchedProject).not.toHaveBeenCalled()
  })

  it('carries the rest of the retrieve as the dialog’s deferred action', async () => {
    await continueWithDevice()

    await waitFor(() => expect(openModal).toHaveBeenCalled())
    const data = openModal.mock.calls[0][1] as { onAfterAction: () => void }
    data.onAfterAction()

    await waitFor(() => expect(openFetchedProject).toHaveBeenCalledWith(FETCHED))
    expect(toastTitles()).toContain('Retrieved "Irrigation Controller"')
  })

  it('says the retrieve stopped when the save it was waiting for failed', async () => {
    // Reachable by design: retrieve a project, edit it, retrieve again. The open
    // project has no location, so saving it refuses and points at Save As --
    // which used to drop the fetched project with only that toast on screen.
    await continueWithDevice()

    await waitFor(() => expect(openModal).toHaveBeenCalled())
    const data = openModal.mock.calls[0][1] as { onActionAborted: (r: 'save-failed' | 'cancelled') => void }
    data.onActionAborted('save-failed')

    expect(toastTitles()).toContain('Retrieve stopped')
    expect(openFetchedProject).not.toHaveBeenCalled()
  })

  it('says so when the dialog is cancelled, rather than vanishing', async () => {
    await continueWithDevice()

    await waitFor(() => expect(openModal).toHaveBeenCalled())
    const data = openModal.mock.calls[0][1] as { onActionAborted: (r: 'save-failed' | 'cancelled') => void }
    data.onActionAborted('cancelled')

    expect(toastTitles()).toContain('Retrieve stopped')
    expect(openFetchedProject).not.toHaveBeenCalled()
  })
})
