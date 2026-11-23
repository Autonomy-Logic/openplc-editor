import type { RuntimePort, RuntimeUser, UpdateUserParams } from '@root/middleware/shared/ports/runtime-port'

import type { OpenPLCStore } from '../store'

/**
 * Reads the signed-in runtime account with `whoami` and keeps its role in the store. Resolves the account, or null
 * when not connected or the runtime could not say; a failed read leaves the stored role as it was.
 */
export async function refreshRuntimeAccount(store: OpenPLCStore, runtime: RuntimePort): Promise<RuntimeUser | null> {
  if (store.getState().runtimeConnection.connectionStatus !== 'connected') return null
  const result = await runtime.whoAmI().catch(() => ({ success: false, user: undefined }))
  const { runtimeConnection, deviceActions } = store.getState()
  if (runtimeConnection.connectionStatus !== 'connected') return null
  if (!result.success || !result.user) return null
  deviceActions.setRuntimeAccountRole(result.user.role)
  return result.user
}

/** Text of the notice shown when the runtime refused to sign the account in again. */
export function sessionEndedNotice(endpoint: string): string {
  return (
    `${endpoint} refused to sign you in again: your account was deleted or its password was changed. ` +
    'You have been disconnected. Connect again to continue.'
  )
}

/** Disconnects after the runtime ended the session, and says why. Does nothing when not connected. */
export async function disconnectEndedRuntimeSession(store: OpenPLCStore, runtime: RuntimePort): Promise<void> {
  const { runtimeConnection } = store.getState()
  if (runtimeConnection.connectionStatus !== 'connected') return
  const endpoint = runtimeConnection.selectedDevice?.deviceName ?? runtimeConnection.ipAddress ?? 'The runtime'
  const { deviceActions, workspaceActions, modalActions } = store.getState()
  deviceActions.setRuntimeJwtToken(null)
  deviceActions.setRuntimeConnectionStatus('disconnected')
  deviceActions.setRuntimeAccountRole(null)
  deviceActions.setStoredCredentials(null)
  deviceActions.setPlcRuntimeStatus(null)
  workspaceActions.setPlcLogsVisible(false)
  workspaceActions.clearPlcLogs()
  modalActions.openModal('runtime-connection-lost', { label: endpoint, body: sessionEndedNotice(endpoint) })
  await runtime.clearCredentials()
}

/**
 * Changes the signed-in account through the port, which keeps the session signed in with the new password, and keeps
 * the store's stored credentials in step.
 */
export async function updateOwnRuntimeAccount(
  store: OpenPLCStore,
  runtime: RuntimePort,
  userId: number,
  params: UpdateUserParams,
): Promise<{ success: boolean; error?: string }> {
  const result = await runtime.updateOwnAccount(userId, params)
  if (!result.success) return result
  const { runtimeConnection, deviceActions } = store.getState()
  const stored = runtimeConnection.storedCredentials
  if (stored) {
    deviceActions.setStoredCredentials({
      ...stored,
      username: params.username ?? stored.username,
      password: params.password ?? stored.password,
    })
  }
  return result
}
