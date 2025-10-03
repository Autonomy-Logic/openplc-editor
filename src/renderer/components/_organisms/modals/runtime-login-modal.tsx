import { useOpenPLCStore } from '@root/renderer/store'
import { useState } from 'react'

import { Label } from '../../_atoms'
import { Modal, ModalContent, ModalTitle } from '../../_molecules/modal'

const RuntimeLoginModal = () => {
  const { modals, modalActions, deviceDefinitions, deviceActions } = useOpenPLCStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const isOpen = modals['runtime-login']?.open || false

  const handleLogin = async () => {
    setError('')

    if (!username || !password) {
      setError('Username and password are required')
      return
    }

    setIsLoading(true)
    const ipAddress = deviceDefinitions.configuration.runtimeIpAddress || ''

    try {
      const result = await window.bridge.runtimeLogin(ipAddress, username, password)

      if (result.success && result.accessToken) {
        deviceActions.setRuntimeJwtToken(result.accessToken)
        deviceActions.setRuntimeConnectionStatus('connected')
        modalActions.closeModal()
        setUsername('')
        setPassword('')
      } else {
        setError('Login failed: ' + (result.error || 'Invalid credentials'))
      }
    } catch (err) {
      setError('Error: ' + String(err))
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
    <Modal open={isOpen} onOpenChange={(open) => modalActions.onOpenChange('runtime-login', open)}>
      <ModalContent className='flex h-[350px] w-[400px] select-none flex-col items-center justify-start rounded-lg p-6'>
        <ModalTitle className='mb-4 text-xl font-semibold'>Login to OpenPLC Runtime</ModalTitle>

        <p className='mb-6 text-center text-sm text-neutral-600 dark:text-neutral-400'>
          Please enter your credentials to connect to the runtime.
        </p>

        <div className='flex w-full flex-col gap-4'>
          <div>
            <Label htmlFor='login-username' className='mb-2 block text-sm'>
              Username
            </Label>
            <input
              id='login-username'
              type='text'
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className='w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-900'
              disabled={isLoading}
            />
          </div>

          <div>
            <Label htmlFor='login-password' className='mb-2 block text-sm'>
              Password
            </Label>
            <input
              id='login-password'
              type='password'
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void handleLogin()}
              className='w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-900'
              disabled={isLoading}
            />
          </div>

          {error && <p className='text-sm text-red-600 dark:text-red-400'>{error}</p>}

          <div className='mt-4 flex gap-3'>
            <button
              onClick={() => void handleLogin()}
              disabled={isLoading}
              className='flex-1 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark disabled:opacity-50'
            >
              {isLoading ? 'Logging in...' : 'Login'}
            </button>
            <button
              onClick={handleCancel}
              disabled={isLoading}
              className='flex-1 rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-1000 hover:bg-neutral-200 dark:bg-neutral-850 dark:text-neutral-100'
            >
              Cancel
            </button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  )
}

export { RuntimeLoginModal }
