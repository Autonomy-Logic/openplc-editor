import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { RuntimeProvisioningSlice, RuntimeProvisioningState } from './types'

const LINES_KEPT = 200

function initialState(): RuntimeProvisioningState {
  return { view: { stage: 'idle' }, dialogVisible: false, sessionSshPorts: {}, detachRequested: false }
}

const createRuntimeProvisioningSlice: StateCreator<RuntimeProvisioningSlice, [], [], RuntimeProvisioningSlice> = (
  setState,
) => ({
  runtimeProvisioning: initialState(),

  runtimeProvisioningActions: {
    showOffer: (host, sshPort) => {
      setState(
        produce(({ runtimeProvisioning }: RuntimeProvisioningSlice) => {
          runtimeProvisioning.view = { stage: 'offer', host, sshPort, notice: null }
          runtimeProvisioning.dialogVisible = true
        }),
      )
    },

    setOfferNotice: (notice) => {
      setState(
        produce(({ runtimeProvisioning }: RuntimeProvisioningSlice) => {
          if (runtimeProvisioning.view.stage === 'offer') runtimeProvisioning.view.notice = notice
        }),
      )
    },

    declineOffer: () => {
      setState(
        produce(({ runtimeProvisioning }: RuntimeProvisioningSlice) => {
          runtimeProvisioning.view = { stage: 'idle' }
          runtimeProvisioning.dialogVisible = false
        }),
      )
    },

    startRun: ({ host, sshPort, operationId, startedAt }) => {
      setState(
        produce(({ runtimeProvisioning }: RuntimeProvisioningSlice) => {
          runtimeProvisioning.view = {
            stage: 'running',
            host,
            sshPort,
            operationId,
            startedAt,
            phase: 'connecting',
            operation: null,
            cancellable: true,
            latestLine: null,
            lines: [],
          }
          runtimeProvisioning.detachRequested = false
        }),
      )
    },

    applyEvent: (event) => {
      if (event.type !== 'phase' && event.type !== 'output') return
      setState(
        produce(({ runtimeProvisioning }: RuntimeProvisioningSlice) => {
          const view = runtimeProvisioning.view
          if (view.stage !== 'running') return
          if (event.type === 'phase') {
            view.phase = event.phase
            view.cancellable = event.cancellable
            view.operation = event.operation ?? view.operation
            return
          }
          view.latestLine = event.line
          view.lines.push(event.line)
          if (view.lines.length > LINES_KEPT) {
            view.lines.splice(0, view.lines.length - LINES_KEPT)
          }
        }),
      )
    },

    finishRun: (outcome, endedAt) => {
      setState(
        produce(({ runtimeProvisioning }: RuntimeProvisioningSlice) => {
          const view = runtimeProvisioning.view
          if (view.stage !== 'running') return
          runtimeProvisioning.view = {
            stage: 'ended',
            host: view.host,
            sshPort: view.sshPort,
            operationId: view.operationId,
            startedAt: view.startedAt,
            endedAt,
            outcome,
            lines: view.lines,
            acknowledged: false,
          }
        }),
      )
    },

    setDialogVisible: (visible) => {
      setState(
        produce(({ runtimeProvisioning }: RuntimeProvisioningSlice) => {
          runtimeProvisioning.dialogVisible = visible
        }),
      )
    },

    acknowledgeEnding: () => {
      setState(
        produce(({ runtimeProvisioning }: RuntimeProvisioningSlice) => {
          runtimeProvisioning.view = { stage: 'idle' }
          runtimeProvisioning.dialogVisible = false
        }),
      )
    },

    rememberSshPort: (host, port) => {
      setState(
        produce(({ runtimeProvisioning }: RuntimeProvisioningSlice) => {
          runtimeProvisioning.sessionSshPorts[host] = port
        }),
      )
    },

    requestDetachOnProjectClose: () => {
      setState(
        produce(({ runtimeProvisioning }: RuntimeProvisioningSlice) => {
          if (runtimeProvisioning.view.stage === 'running') runtimeProvisioning.detachRequested = true
          if (runtimeProvisioning.view.stage === 'offer') {
            runtimeProvisioning.view = { stage: 'idle' }
            runtimeProvisioning.dialogVisible = false
          }
        }),
      )
    },

    clearDetachRequest: () => {
      setState(
        produce(({ runtimeProvisioning }: RuntimeProvisioningSlice) => {
          runtimeProvisioning.detachRequested = false
        }),
      )
    },
  },
})

export { createRuntimeProvisioningSlice }
