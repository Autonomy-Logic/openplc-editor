import { useEffect, useRef } from 'react'

import { useRuntime } from '../../../../middleware/shared/providers'
import { useOpenPLCStore } from '../../../store'
import { getErrorMessage } from '../../../utils/get-error-message'
import { RuntimeUserModal, type RuntimeUserModalSubmit } from './runtime-user-modal'

/**
 * First-user bootstrap dialog: shown when connecting to a runtime that has no
 * accounts yet. Reuses the shared RuntimeUserModal form and, on success, also
 * logs in as the new user and marks the connection as established (the runtime
 * always makes this first account an admin).
 */
const RuntimeCreateUserModal = () => {
  const { modals, modalActions, deviceActions } = useOpenPLCStore()
  const runtime = useRuntime()

  const isOpen = modals['runtime-create-user']?.open || false

  // Tracks whether this run successfully created + logged in. A ref (not the
  // store's connectionStatus) because handleSubmit sets the status and the
  // modal then calls onOpenChange(false) synchronously — before a re-render —
  // so reading connectionStatus from the render closure would be stale and the
  // close handler would wrongly tear down the just-established connection.
  const succeededRef = useRef(false)

  useEffect(() => {
    if (isOpen) succeededRef.current = false
  }, [isOpen])

  const handleSubmit = async ({ username, password }: RuntimeUserModalSubmit): Promise<string | null> => {
    if (!password) return 'Password is required'
    try {
      const result = await runtime.createUser({ username, password })
      if (!result.success) {
        return 'Failed to create user: ' + (result.error || 'Unknown error')
      }
      const loginResult = await runtime.login({ username, password })
      if (loginResult.success && loginResult.accessToken) {
        deviceActions.setRuntimeJwtToken(loginResult.accessToken)
        deviceActions.setRuntimeConnectionStatus('connected')
        deviceActions.setStoredCredentials({ username, password })
        succeededRef.current = true
        return null
      }
      return 'User created but login failed: ' + (loginResult.error || 'Unknown error')
    } catch (err) {
      return 'Error: ' + getErrorMessage(err)
    }
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      // Only a genuine cancel (no successful login this run) abandons the
      // connection attempt; a success close must keep the 'connected' status.
      if (isOpen && !succeededRef.current) {
        deviceActions.setRuntimeConnectionStatus('disconnected')
      }
      modalActions.closeModal()
    }
    modalActions.onOpenChange('runtime-create-user', open)
  }

  return (
    <RuntimeUserModal
      open={isOpen}
      onOpenChange={handleOpenChange}
      mode='bootstrap'
      title='Create First User'
      description='This OpenPLC Runtime has no users registered. Please create the first user account.'
      submitLabel='Create User'
      onSubmit={handleSubmit}
    />
  )
}

export { RuntimeCreateUserModal }
