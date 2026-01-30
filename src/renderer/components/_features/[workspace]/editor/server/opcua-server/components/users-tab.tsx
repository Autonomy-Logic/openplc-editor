import { useOpenPLCStore } from '@root/renderer/store'
import type { OpcUaServerConfig, OpcUaUser } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import { useCallback, useMemo, useState } from 'react'

import { UserModal } from './user-modal'

interface UsersTabProps {
  config: OpcUaServerConfig
  serverName: string
  onConfigChange: () => void
}

// Helper to get role display info
const getRoleInfo = (role: OpcUaUser['role']): { label: string; description: string; color: string } => {
  switch (role) {
    case 'viewer':
      return {
        label: 'Viewer',
        description: 'Read-only access',
        color: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
      }
    case 'operator':
      return {
        label: 'Operator',
        description: 'Read/Write per variable permissions',
        color: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
      }
    case 'engineer':
      return {
        label: 'Engineer',
        description: 'Full access',
        color: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
      }
  }
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
        <div className='rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950'>
          <p className='text-xs text-amber-700 dark:text-amber-400'>
            Warning: Username authentication is enabled but no password users exist. Add at least one user for clients
            to authenticate.
          </p>
        </div>
      )}

      {/* Add User Button */}
      <button
        type='button'
        onClick={handleAddUser}
        className='flex h-[36px] w-fit items-center gap-2 rounded-md border border-neutral-300 bg-white px-4 font-caption !text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700'
      >
        <span className='text-lg leading-none'>+</span>
        Add User
      </button>

      {/* Users List */}
      {config.users.length === 0 ? (
        <div className='rounded-lg border border-neutral-200 bg-neutral-50 p-6 text-center dark:border-neutral-800 dark:bg-neutral-900'>
          <p className='text-xs text-neutral-500 dark:text-neutral-400'>
            No users configured. Add users for password or certificate authentication.
          </p>
        </div>
      ) : (
        <div className='flex flex-col gap-3'>
          {config.users.map((user) => {
            const roleInfo = getRoleInfo(user.role)
            return (
              <div
                key={user.id}
                className='flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900'
              >
                {/* Header row with icon, name, and actions */}
                <div className='flex items-center justify-between'>
                  <div className='flex items-center gap-3'>
                    {/* User Icon */}
                    <span className='text-lg'>{user.type === 'password' ? '👤' : '🔐'}</span>

                    {/* User Name */}
                    <span className='font-caption text-sm font-semibold text-neutral-950 dark:text-white'>
                      {getUserDisplayName(user)}
                    </span>

                    {/* Role Badge */}
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', roleInfo.color)}>
                      {roleInfo.label}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className='flex items-center gap-2'>
                    <button
                      type='button'
                      onClick={() => handleEditUser(user)}
                      className='h-[28px] rounded-md border border-neutral-300 bg-white px-3 font-caption !text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700'
                    >
                      Edit
                    </button>
                    <button
                      type='button'
                      onClick={() => handleDeleteUser(user.id)}
                      className='h-[28px] rounded-md border border-red-300 bg-white px-3 font-caption !text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:bg-neutral-800 dark:text-red-400 dark:hover:bg-red-950'
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {/* User Details */}
                <div className='flex flex-col gap-1 pl-[36px]'>
                  <p className='font-caption text-xs text-neutral-600 dark:text-neutral-400'>
                    <span className='font-medium'>Type:</span>{' '}
                    {user.type === 'password' ? 'Password Authentication' : 'Certificate Authentication'}
                  </p>
                  {user.type === 'certificate' && user.certificateId && (
                    <p className='font-caption text-xs text-neutral-600 dark:text-neutral-400'>
                      <span className='font-medium'>Certificate:</span> {user.certificateId}
                    </p>
                  )}
                  <p className='font-caption text-xs text-neutral-500 dark:text-neutral-500'>{roleInfo.description}</p>
                </div>
              </div>
            )
          })}
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
