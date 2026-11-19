import type { RuntimeProvisioningPort } from '@root/middleware/shared/ports/runtime-provisioning-port'

import type { OpenPLCStore } from '../../store'
import type { RuntimeConnectPorts } from '../runtime-connect'

export async function retryWithSshPort(
  store: OpenPLCStore,
  ports: RuntimeConnectPorts,
  host: string,
  port: number,
): Promise<void> {
  const provisioning = ports.runtimeProvisioning
  if (provisioning === undefined) return
  const probe = await provisioning.probeSsh({ host, port })
  const { modalActions, runtimeProvisioningActions } = store.getState()
  if (!probe.answered) {
    modalActions.openModal('runtime-no-device', { host, sshPort: port })
    return
  }
  runtimeProvisioningActions.rememberSshPort(host, port)
  modalActions.onOpenChange('runtime-no-device', false)
  runtimeProvisioningActions.showOffer(host, port)
}

export function declineProvisioningOffer(store: OpenPLCStore): void {
  const { runtimeProvisioningActions, deviceActions } = store.getState()
  runtimeProvisioningActions.declineOffer()
  deviceActions.setRuntimeConnectionStatus('disconnected')
}

export async function cancelProvisioning(store: OpenPLCStore, port: RuntimeProvisioningPort): Promise<void> {
  const { view } = store.getState().runtimeProvisioning
  if (view.stage === 'offer') {
    declineProvisioningOffer(store)
    return
  }
  if (view.stage === 'running' && view.cancellable) await port.cancel()
}

export function hideProvisioningDialog(store: OpenPLCStore): void {
  store.getState().runtimeProvisioningActions.setDialogVisible(false)
}

export function reopenProvisioningDialog(store: OpenPLCStore): void {
  store.getState().runtimeProvisioningActions.setDialogVisible(true)
}
