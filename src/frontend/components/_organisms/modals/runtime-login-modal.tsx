import { useState } from 'react'

import { useRuntime } from '../../../../middleware/shared/providers'
import { useOpenPLCStore } from '../../../store'
import { getErrorMessage } from '../../../utils/get-error-message'
import { Label } from '../../_atoms/label'
import { Modal, ModalContent, ModalTitle } from '../../_molecules/modal'

const RuntimeLoginModal = () => {
  const { modals, modalActions, deviceActions, runtimeConnection } = useOpenPLCStore()
  const runtime = useRuntime()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const isOpen = modals['runtime-login']?.open || false

  // Build a stable unique suffix for input ids to prevent browser autofill
  const deviceId = runtimeConnection.selectedDevice?.deviceId || 'default'

  const handleLogin = async () => {
    setError('')

    if (!username || !password) {
      setError('Username and password are required')
      return
    }

    setIsLoading(true)

    try {
      const result = await runtime.login({ username, password })

      if (result.success && result.accessToken) {
        deviceActions.setRuntimeJwtToken(result.accessToken)
        deviceActions.setRuntimeConnectionStatus('connected')
        deviceActions.setStoredCredentials({ username, password })
        modalActions.closeModal()
        setUsername('')
        setPassword('')
      } else {
        setError('Login failed: ' + (result.error || 'Invalid credentials'))
      }
    } catch (err) {
      setError('Error: ' + getErrorMessage(err))
    } finally {
      setIsLoading(false)
    }
  }

  const handleCancel = () => {
    modalActions.closeModal()
    deviceActions.setRuntimeConnectionStatus('disconnected')
    setUsername('')
    setPassword('')
    setError('')
  }

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          handleCancel()
        }
        modalActions.onOpenChange('runtime-login', open)
      }}
    >
      <ModalContent className='flex min-h-[380px] w-[400px] select-none flex-col items-center justify-start rounded-lg p-6'>
        <ModalTitle className='mb-4 text-xl font-semibold'>Login to OpenPLC Runtime</ModalTitle>

        <p className='mb-6 text-center text-sm text-neutral-600 dark:text-neutral-400'>
          Please enter your credentials to connect to the runtime.
        </p>

        <form
          autoComplete='off'
          onSubmit={(e) => {
            e.preventDefault()
            void handleLogin()
          }}
          className='flex w-full flex-col gap-4'
        >
          <div>
            <Label htmlFor={`runtime-user-${deviceId}`} className='mb-2 block text-sm'>
              Username
            </Label>
            <input
              id={`runtime-user-${deviceId}`}
              name={`runtime-user-${deviceId}`}
              type='text'
              autoComplete='off'
              autoCapitalize='none'
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder='Enter username'
              className='w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-850 outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300'
              disabled={isLoading}
            />
          </div>

          <div>
            <Label htmlFor={`runtime-pass-${deviceId}`} className='mb-2 block text-sm'>
              Password
            </Label>
            <input
              id={`runtime-pass-${deviceId}`}
              name={`runtime-pass-${deviceId}`}
              type='password'
              autoComplete='off'
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder='Enter password'
              className='w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-850 outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300'
              disabled={isLoading}
            />
          </div>

          {error && <p className='text-sm text-red-600 dark:text-red-400'>{error}</p>}

          <div className='mt-4 flex gap-3'>
            <button
              type='submit'
              disabled={isLoading}
              className='flex-1 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark disabled:opacity-50'
            >
              {isLoading ? 'Logging in...' : 'Login'}
            </button>
            <button
              type='button'
              onClick={handleCancel}
              disabled={isLoading}
              className='flex-1 rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-1000 hover:bg-neutral-200 dark:bg-neutral-850 dark:text-neutral-100'
            >
              Cancel
            </button>
          </div>
        </form>
      </ModalContent>
    </Modal>
  )
}

export { RuntimeLoginModal }
