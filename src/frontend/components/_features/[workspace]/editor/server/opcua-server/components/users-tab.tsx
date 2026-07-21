import { Pencil1Icon, PlusIcon, TrashIcon } from '@radix-ui/react-icons'
import { useOpenPLCStore } from '@root/frontend/store'
import type { OpcUaServerConfig, OpcUaUser } from '@root/middleware/shared/ports/types'
import { useCallback, useMemo, useState } from 'react'

import { UserModal } from './user-modal'

interface UsersTabProps {
  config: OpcUaServerConfig
  serverName: string
  onConfigChange: () => void
}

const ROLE_LABELS: Record<OpcUaUser['role'], string> = {
  viewer: 'Viewer',
  operator: 'Operator',
  engineer: 'Engineer',
}

// Helper to get user display name
const getUserDisplayName = (user: OpcUaUser): string => {
  if (user.type === 'password') {
    return user.username ?? 'Unknown'
  }
  return user.certificateId ?? 'Unknown Certificate'
}

export const UsersTab = ({ config, serverName, onConfigChange }: UsersTabProps) => {
  const {
    projectActions: { addOpcUaUser, updateOpcUaUser, removeOpcUaUser },
  } = useOpenPLCStore()

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<OpcUaUser | undefined>(undefined)

  // Check if username authentication is enabled in any security profile
  const usernameAuthEnabled = useMemo(
    () => config.securityProfiles.some((p) => p.enabled && p.authMethods.includes('Username')),
    [config.securityProfiles],
  )

  // Check if we have any password users when username auth is enabled
  const passwordUserCount = useMemo(() => config.users.filter((u) => u.type === 'password').length, [config.users])

  // Get existing usernames for validation
  const existingUsernames = useMemo(
    () => config.users.filter((u) => u.type === 'password' && u.username).map((u) => u.username as string),
    [config.users],
  )

  // Get certificate IDs that are already bound to users
  const usedCertificateIds = useMemo(
    () => config.users.filter((u) => u.type === 'certificate' && u.certificateId).map((u) => u.certificateId as string),
    [config.users],
  )

  // Handle adding a new user
  const handleAddUser = useCallback(() => {
    setEditingUser(undefined)
    setIsModalOpen(true)
  }, [])

  // Handle editing an existing user
  const handleEditUser = useCallback((user: OpcUaUser) => {
    setEditingUser(user)
    setIsModalOpen(true)
  }, [])

  // Handle saving a user (add or update)
  const handleSaveUser = useCallback(
    (user: OpcUaUser) => {
      if (editingUser) {
        updateOpcUaUser(serverName, user.id, user)
      } else {
        addOpcUaUser(serverName, user)
      }
      onConfigChange()
    },
    [serverName, editingUser, addOpcUaUser, updateOpcUaUser, onConfigChange],
  )

  // Handle deleting a user
  const handleDeleteUser = useCallback(
    (userId: string) => {
      removeOpcUaUser(serverName, userId)
      onConfigChange()
    },
    [serverName, removeOpcUaUser, onConfigChange],
  )

  return (
    <div className='flex flex-col gap-4'>
      {/* Header and description */}
      <div className='flex flex-col gap-2'>
        <p className='text-xs text-neutral-600 dark:text-neutral-400'>
          Configure user accounts for OPC-UA client authentication.
        </p>
      </div>

      {/* Warning if username auth is enabled but no users */}
      {usernameAuthEnabled && passwordUserCount === 0 && (
        <div className='rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900'>
          <p className='text-xs text-neutral-700 dark:text-neutral-300'>
            Warning: Username authentication is enabled but no password users exist. Add at least one user for clients
            to authenticate.
          </p>
        </div>
      )}

      {/* Add User Button */}
      <button
        type='button'
        onClick={handleAddUser}
        className='flex w-fit items-center gap-2 rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark'
      >
        <PlusIcon className='h-4 w-4' />
        Add User
      </button>

      {/* Users Table */}
      {config.users.length === 0 ? (
        <p className='text-sm text-neutral-500 dark:text-neutral-400'>
          No users configured. Add users for password or certificate authentication.
        </p>
      ) : (
        <div className='overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700'>
          <table className='w-full'>
            <thead className='bg-neutral-100 dark:bg-neutral-900'>
              <tr>
                <th className='px-3 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>Name</th>
                <th className='px-3 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>Type</th>
                <th className='px-3 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>Role</th>
                <th className='px-3 py-2 text-right text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {config.users.map((user) => (
                <tr key={user.id} className='border-t border-neutral-200 dark:border-neutral-700'>
                  <td className='px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100'>
                    {getUserDisplayName(user)}
                  </td>
                  <td className='px-3 py-2 text-sm text-neutral-600 dark:text-neutral-400'>
                    {user.type === 'password' ? 'Password' : 'Certificate'}
                  </td>
                  <td className='px-3 py-2 text-sm text-neutral-600 dark:text-neutral-400'>{ROLE_LABELS[user.role]}</td>
                  <td className='px-3 py-2 text-right'>
                    <div className='flex justify-end gap-2'>
                      <button
                        type='button'
                        onClick={() => handleEditUser(user)}
                        className='rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200'
                        title='Edit'
                      >
                        <Pencil1Icon className='h-4 w-4' />
                      </button>
                      <button
                        type='button'
                        onClick={() => handleDeleteUser(user.id)}
                        className='rounded p-1 text-neutral-500 hover:bg-red-100 hover:text-red-600 dark:text-neutral-400 dark:hover:bg-red-900/30 dark:hover:text-red-400'
                        title='Delete'
                      >
                        <TrashIcon className='h-4 w-4' />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Role Descriptions */}
      <div className='mt-2 border-t border-neutral-200 pt-4 dark:border-neutral-800'>
        <h4 className='mb-2 font-caption text-xs font-semibold text-neutral-950 dark:text-white'>Role Descriptions:</h4>
        <ul className='space-y-1 text-xs text-neutral-500 dark:text-neutral-400'>
          <li>
            • <span className='font-medium'>Viewer:</span> Can only read variable values (monitoring)
          </li>
          <li>
            • <span className='font-medium'>Operator:</span> Can read/write based on per-variable permissions
          </li>
          <li>
            • <span className='font-medium'>Engineer:</span> Full administrative access to all variables
          </li>
        </ul>
      </div>

      {/* Modal for adding/editing users */}
      <UserModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveUser}
        existingUser={editingUser}
        existingUsernames={existingUsernames}
        trustedCertificates={config.security.trustedClientCertificates}
        usedCertificateIds={usedCertificateIds}
      />
    </div>
  )
}
