import { useOpenPLCStore } from '@root/renderer/store'
import { validateIpAddress } from '@root/utils'
import { useState } from 'react'

import { Label } from '../../_atoms'
import { Modal, ModalContent, ModalTitle } from '../../_molecules/modal'

const RuntimeCreateUserModal = () => {
  const { modals, modalActions, deviceDefinitions, deviceActions } = useOpenPLCStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const isOpen = modals['runtime-create-user']?.open || false

  const handleCreateUser = async () => {
    setError('')

    if (!username || !password) {
      setError('Username and password are required')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setIsLoading(true)
    const ipAddress = deviceDefinitions.configuration.runtimeIpAddress || ''

    const ipValidation = validateIpAddress(ipAddress)
    if (!ipValidation.valid) {
      setError('Runtime IP address not configured: ' + (ipValidation.message || 'Invalid IP address'))
      setIsLoading(false)
      return
    }

    try {
      const result = await window.bridge.runtimeCreateUser(ipAddress, username, password)

      if (result.success) {
        const loginResult = await window.bridge.runtimeLogin(ipAddress, username, password)
        if (loginResult.success && loginResult.accessToken) {
          deviceActions.setRuntimeJwtToken(loginResult.accessToken)
          deviceActions.setRuntimeConnectionStatus('connected')
          modalActions.closeModal()
          setUsername('')
          setPassword('')
          setConfirmPassword('')
        } else {
          setError('User created but login failed: ' + (loginResult.error || 'Unknown error'))
        }
      } else {
        setError('Failed to create user: ' + (result.error || 'Unknown error'))
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
    setConfirmPassword('')
    setError('')
  }

  return (
    <Modal open={isOpen} onOpenChange={(open) => modalActions.onOpenChange('runtime-create-user', open)}>
      <ModalContent className='flex min-h-[480px] w-[400px] select-none flex-col items-center justify-start rounded-lg p-6'>
        <ModalTitle className='mb-4 text-xl font-semibold'>Create First User</ModalTitle>

        <p className='mb-6 text-center text-sm text-neutral-600 dark:text-neutral-400'>
          This OpenPLC Runtime has no users registered. Please create the first user account.
        </p>

        <div className='flex w-full flex-col gap-4'>
          <div>
            <Label htmlFor='username' className='mb-2 block text-sm'>
              Username
            </Label>
            <input
              id='username'
              type='text'
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder='Enter username'
              className='w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-850 outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300'
              disabled={isLoading}
            />
          </div>

          <div>
            <Label htmlFor='password' className='mb-2 block text-sm'>
              Password
            </Label>
            <input
              id='password'
              type='password'
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder='Enter password'
              className='w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-850 outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300'
              disabled={isLoading}
            />
          </div>

          <div>
            <Label htmlFor='confirm-password' className='mb-2 block text-sm'>
              Confirm Password
            </Label>
            <input
              id='confirm-password'
              type='password'
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder='Confirm password'
              className='w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-850 outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300'
              disabled={isLoading}
            />
          </div>

          {error && <p className='text-sm text-red-600 dark:text-red-400'>{error}</p>}

          <div className='mt-4 flex gap-3'>
            <button
              onClick={() => void handleCreateUser()}
              disabled={isLoading}
              className='flex-1 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark disabled:opacity-50'
            >
              {isLoading ? 'Creating...' : 'Create User'}
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

export { RuntimeCreateUserModal }
