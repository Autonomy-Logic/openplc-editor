import {
  type RuntimeProvisioningEvent,
  type RuntimeProvisioningOutcome,
  type RuntimeProvisioningPort,
  type RuntimeProvisioningRunRequest,
  validateRunRequest,
} from '@root/middleware/shared/ports/runtime-provisioning-port'

import type { OpenPLCStore } from '../../store'
import { connectRuntime, type RuntimeConnectPorts } from '../runtime-connect'

export interface ProvisioningRunInput {
  username: string
  password: string
  sshPort: number
}

let lastOperationId = 0

function followEvent(store: OpenPLCStore, event: RuntimeProvisioningEvent): void {
  const { consoleActions, runtimeProvisioningActions } = store.getState()
  if (event.type === 'console') {
    consoleActions.addLog({ level: event.level, message: event.message })
  } else if (event.type === 'audit') {
    consoleActions.addLog({ level: 'info', message: event.line })
  } else {
    runtimeProvisioningActions.applyEvent(event)
  }
}

function forwardEvents(store: OpenPLCStore, provisioning: RuntimeProvisioningPort): () => void {
  let unsubscribe: (() => void) | null = provisioning.onEvent((event) => followEvent(store, event))
  return () => {
    const stop = unsubscribe
    unsubscribe = null
    stop?.()
  }
}

function detachOnProjectClose(
  store: OpenPLCStore,
  provisioning: RuntimeProvisioningPort,
  stopEvents: () => void,
): () => void {
  return store.subscribe(
    (state) => state.runtimeProvisioning.detachRequested,
    (requested) => {
      if (!requested) return
      stopEvents()
      store.getState().runtimeProvisioningActions.clearDetachRequest()
      void provisioning.cancel()
    },
  )
}

async function runFollowed(
  store: OpenPLCStore,
  provisioning: RuntimeProvisioningPort,
  request: RuntimeProvisioningRunRequest,
): Promise<RuntimeProvisioningOutcome> {
  const stopEvents = forwardEvents(store, provisioning)
  const stopDetach = detachOnProjectClose(store, provisioning, stopEvents)
  try {
    return await provisioning.run(request)
  } catch {
    return { kind: 'unknown' }
  } finally {
    stopEvents()
    stopDetach()
  }
}

async function handleOutcome(
  store: OpenPLCStore,
  ports: RuntimeConnectPorts,
  target: { host: string; sshPort: number },
  outcome: RuntimeProvisioningOutcome,
): Promise<void> {
  const { runtimeProvisioningActions, deviceActions } = store.getState()
  deviceActions.setRuntimeConnectionStatus('disconnected')
  if (outcome.kind === 'auth-rejected' || outcome.kind === 'invalid-input') {
    runtimeProvisioningActions.showOffer(target.host, target.sshPort)
    runtimeProvisioningActions.setOfferNotice(
      outcome.kind === 'auth-rejected' ? { kind: 'login-rejected' } : { kind: 'input-refused', field: outcome.field },
    )
    return
  }
  runtimeProvisioningActions.finishRun(outcome, Date.now())
  if (outcome.kind === 'busy') {
    runtimeProvisioningActions.setDialogVisible(true)
    return
  }
  if (outcome.kind === 'connected-ready') {
    runtimeProvisioningActions.setDialogVisible(false)
    await connectRuntime(store, ports, { allowProvisioningFlow: false })
  }
}

export async function submitProvisioningRun(
  store: OpenPLCStore,
  ports: RuntimeConnectPorts,
  input: ProvisioningRunInput,
): Promise<void> {
  const provisioning = ports.runtimeProvisioning
  const { view } = store.getState().runtimeProvisioning
  if (provisioning === undefined || view.stage !== 'offer') return
  const target = { host: view.host, sshPort: input.sshPort }
  const validation = validateRunRequest({
    host: target.host,
    port: target.sshPort,
    username: input.username,
    password: input.password,
  })
  if (!validation.ok) {
    store.getState().runtimeProvisioningActions.setOfferNotice({ kind: 'input-refused', field: validation.field })
    return
  }
  lastOperationId += 1
  store.getState().runtimeProvisioningActions.startRun({
    host: target.host,
    sshPort: target.sshPort,
    operationId: lastOperationId,
    startedAt: Date.now(),
  })
  const outcome = await runFollowed(store, provisioning, validation.request)
  await handleOutcome(store, ports, target, outcome)
}
