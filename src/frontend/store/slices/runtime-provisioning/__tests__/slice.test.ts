import type { RuntimeProvisioningEvent } from '../../../../../middleware/shared/ports/runtime-provisioning-port'
import type { OpenPLCStore } from '../../..'
import { createTestStore } from '../../../testing'

const HOST = '192.168.1.50'
const STARTED_AT = 1_700_000_000_000
const ENDED_AT = 1_700_000_090_000

let store: OpenPLCStore

function actions() {
  return store.getState().runtimeProvisioningActions
}

function slice() {
  return store.getState().runtimeProvisioning
}

function startRunning(): void {
  actions().showOffer(HOST, 22)
  actions().startRun({ host: HOST, sshPort: 22, operationId: 7, startedAt: STARTED_AT })
}

function output(line: string): RuntimeProvisioningEvent {
  return { type: 'output', line }
}

function finishedRun(): void {
  startRunning()
  actions().finishRun({ kind: 'cancelled' }, ENDED_AT)
}

const STAGES_WITHOUT_A_RUN: [string, () => void][] = [
  ['idle', () => undefined],
  ['offer', () => actions().showOffer(HOST, 22)],
  ['ended', finishedRun],
]

beforeEach(() => {
  store = createTestStore()
})

describe('the runtime provisioning slice', () => {
  it('starts idle and hidden, with no remembered port and no detach request', () => {
    expect(slice()).toEqual({
      view: { stage: 'idle' },
      dialogVisible: false,
      sessionSshPorts: {},
      detachRequested: false,
    })
  })

  it('shows an offer for the host and SSH port, with no notice, and shows the dialog', () => {
    actions().showOffer(HOST, 2222)

    expect(slice().view).toEqual({ stage: 'offer', host: HOST, sshPort: 2222, notice: null })
    expect(slice().dialogVisible).toBe(true)
  })

  it('drops an earlier notice when a new offer is shown', () => {
    actions().showOffer(HOST, 22)
    actions().setOfferNotice({ kind: 'login-rejected' })

    actions().showOffer(HOST, 22)

    expect(slice().view).toEqual({ stage: 'offer', host: HOST, sshPort: 22, notice: null })
  })

  it('sets and clears the notice of an offer', () => {
    actions().showOffer(HOST, 22)

    actions().setOfferNotice({ kind: 'input-refused', field: 'port' })
    const refused = slice().view
    actions().setOfferNotice(null)

    expect(refused).toEqual({
      stage: 'offer',
      host: HOST,
      sshPort: 22,
      notice: { kind: 'input-refused', field: 'port' },
    })
    expect(slice().view).toEqual({ stage: 'offer', host: HOST, sshPort: 22, notice: null })
  })

  it('returns to idle and hides the dialog when the offer is declined', () => {
    actions().showOffer(HOST, 22)

    actions().declineOffer()

    expect(slice().view).toEqual({ stage: 'idle' })
    expect(slice().dialogVisible).toBe(false)
  })

  it('starts a run with its operation, start time and no output yet', () => {
    startRunning()

    expect(slice().view).toEqual(
      expect.objectContaining({
        stage: 'running',
        host: HOST,
        sshPort: 22,
        operationId: 7,
        startedAt: STARTED_AT,
        latestLine: null,
        lines: [],
      }),
    )
  })

  it('follows the phase, the operation and whether it can be cancelled', () => {
    startRunning()

    actions().applyEvent({ type: 'phase', phase: 'installing', cancellable: true, operation: 'install' })
    const installing = slice().view
    actions().applyEvent({ type: 'phase', phase: 'waiting-runtime', cancellable: false, operation: 'install' })

    expect(installing).toEqual(
      expect.objectContaining({ phase: 'installing', cancellable: true, operation: 'install' }),
    )
    expect(slice().view).toEqual(
      expect.objectContaining({ phase: 'waiting-runtime', cancellable: false, operation: 'install' }),
    )
  })

  it('keeps the latest output line and appends every line', () => {
    startRunning()

    actions().applyEvent(output('Downloading the installer'))
    actions().applyEvent(output('Installing Docker'))

    expect(slice().view).toEqual(
      expect.objectContaining({
        latestLine: 'Installing Docker',
        lines: ['Downloading the installer', 'Installing Docker'],
      }),
    )
  })

  it('keeps only the last 200 output lines', () => {
    startRunning()

    for (let index = 1; index <= 205; index += 1) actions().applyEvent(output(`line ${index}`))

    const view = slice().view
    const lines = view.stage === 'running' ? view.lines : []
    expect(lines).toHaveLength(200)
    expect(lines[0]).toBe('line 6')
    expect(lines[199]).toBe('line 205')
    expect(view).toEqual(expect.objectContaining({ latestLine: 'line 205' }))
  })

  it('leaves an earlier state snapshot unchanged when a line arrives', () => {
    startRunning()
    const before = slice()

    actions().applyEvent(output('Installing Docker'))

    expect(before.view).toEqual(expect.objectContaining({ stage: 'running', latestLine: null, lines: [] }))
    expect(slice()).not.toBe(before)
  })

  it.each<RuntimeProvisioningEvent>([
    { type: 'console', level: 'warning', message: 'The device asked for a restart' },
    { type: 'audit', line: 'install started on 192.168.1.50:22' },
  ])('leaves the slice untouched for a $type event', (event) => {
    startRunning()
    actions().applyEvent(output('Installing Docker'))
    const before = slice()

    actions().applyEvent(event)

    expect(slice()).toEqual(before)
  })

  it('ends a run with its outcome and output, not yet acknowledged', () => {
    startRunning()
    actions().applyEvent(output('E: package docker-ce is not available'))

    actions().finishRun({ kind: 'installer-failed', lastLines: ['E: package docker-ce is not available'] }, ENDED_AT)

    expect(slice().view).toEqual({
      stage: 'ended',
      host: HOST,
      sshPort: 22,
      operationId: 7,
      startedAt: STARTED_AT,
      endedAt: ENDED_AT,
      outcome: { kind: 'installer-failed', lastLines: ['E: package docker-ce is not available'] },
      lines: ['E: package docker-ce is not available'],
      acknowledged: false,
    })
  })

  it('hides and shows the dialog without changing the view', () => {
    startRunning()
    const view = slice().view

    actions().setDialogVisible(false)
    const hidden = slice().dialogVisible
    actions().setDialogVisible(true)

    expect(hidden).toBe(false)
    expect(slice().dialogVisible).toBe(true)
    expect(slice().view).toEqual(view)
  })

  it('returns to idle and hides the dialog when the ending is acknowledged', () => {
    startRunning()
    actions().finishRun({ kind: 'unknown' }, ENDED_AT)

    actions().acknowledgeEnding()

    expect(slice().view).toEqual({ stage: 'idle' })
    expect(slice().dialogVisible).toBe(false)
  })

  it('remembers one SSH port per host and replaces it on a new answer', () => {
    actions().rememberSshPort(HOST, 2222)
    actions().rememberSshPort('192.168.1.99', 2200)
    actions().rememberSshPort(HOST, 2022)

    expect(slice().sessionSshPorts).toEqual({ [HOST]: 2022, '192.168.1.99': 2200 })
  })

  it('requests a detach on project close while a run is in progress, and clears it', () => {
    startRunning()

    actions().requestDetachOnProjectClose()
    const requested = slice().detachRequested
    actions().clearDetachRequest()

    expect(requested).toBe(true)
    expect(slice().detachRequested).toBe(false)
  })

  it.each(STAGES_WITHOUT_A_RUN)('requests no detach when the stage is %s', (_stage, arrange) => {
    arrange()

    actions().requestDetachOnProjectClose()

    expect(slice().detachRequested).toBe(false)
  })

  it('declines an open offer on project close: idle, hidden, no detach, remembered ports kept (AC02)', () => {
    actions().rememberSshPort(HOST, 2222)
    actions().showOffer(HOST, 2222)

    actions().requestDetachOnProjectClose()

    expect(slice()).toEqual({
      view: { stage: 'idle' },
      dialogVisible: false,
      sessionSshPorts: { [HOST]: 2222 },
      detachRequested: false,
    })
  })

  it('keeps an ending and its dialog as they are on project close', () => {
    finishedRun()
    const before = slice()

    actions().requestDetachOnProjectClose()

    expect(slice()).toEqual(before)
  })
})

describe('the runtime provisioning slice in the store', () => {
  it('asks a running operation to detach when the project closes, and keeps following it', () => {
    startRunning()

    store.getState().sharedWorkspaceActions.clearStatesOnCloseProject()

    expect(slice().detachRequested).toBe(true)
    expect(slice().view).toEqual(expect.objectContaining({ stage: 'running', host: HOST, operationId: 7 }))
  })

  it('keeps an ending and the remembered ports across a project close', () => {
    actions().rememberSshPort(HOST, 2222)
    startRunning()
    actions().finishRun({ kind: 'unknown' }, ENDED_AT)
    const ended = slice().view

    store.getState().sharedWorkspaceActions.clearStatesOnCloseProject()

    expect(slice().view).toEqual(ended)
    expect(slice().detachRequested).toBe(false)
    expect(slice().sessionSshPorts).toEqual({ [HOST]: 2222 })
  })

  it('declines an open offer when the project closes, hiding its dialog', () => {
    actions().showOffer(HOST, 22)

    store.getState().sharedWorkspaceActions.clearStatesOnCloseProject()

    expect(slice().view).toEqual({ stage: 'idle' })
    expect(slice().dialogVisible).toBe(false)
    expect(slice().detachRequested).toBe(false)
  })

  it('keeps the dialog visible when every modal is closed', () => {
    startRunning()

    store.getState().modalActions.closeModal()

    expect(slice().dialogVisible).toBe(true)
  })

  it('registers the no-recognized-device modal, closed by default and by closeModal', () => {
    const initially = store.getState().modals['runtime-no-device']
    store.getState().modalActions.openModal('runtime-no-device', { host: HOST, sshPort: 22 })
    const opened = store.getState().modals['runtime-no-device']

    store.getState().modalActions.closeModal()

    expect(initially).toEqual({ open: false, data: null })
    expect(opened).toEqual({ open: true, data: { host: HOST, sshPort: 22 } })
    expect(store.getState().modals['runtime-no-device']).toEqual({ open: false, data: null })
  })
})
