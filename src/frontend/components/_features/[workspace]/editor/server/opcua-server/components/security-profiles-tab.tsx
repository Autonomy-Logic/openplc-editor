import { Pencil1Icon, PlusIcon, TrashIcon } from '@radix-ui/react-icons'
import { useOpenPLCStore } from '@root/frontend/store'
import { cn } from '@root/frontend/utils/cn'
import type { OpcUaSecurityProfile, OpcUaServerConfig } from '@root/middleware/shared/ports/types'
import { useCallback, useMemo, useState } from 'react'

import { SecurityProfileModal } from './security-profile-modal'

interface SecurityProfilesTabProps {
  config: OpcUaServerConfig
  serverName: string
  onConfigChange: () => void
}

// Helper to format auth methods for display
const formatAuthMethods = (methods: OpcUaSecurityProfile['authMethods']): string => {
  return methods.join(', ')
}

export const SecurityProfilesTab = ({ config, serverName, onConfigChange }: SecurityProfilesTabProps) => {
  const {
    projectActions: { addOpcUaSecurityProfile, updateOpcUaSecurityProfile, removeOpcUaSecurityProfile },
  } = useOpenPLCStore()

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState<OpcUaSecurityProfile | undefined>(undefined)

  // Get existing profile names for validation
  const existingNames = useMemo(() => config.securityProfiles.map((p) => p.name), [config.securityProfiles])

  // Check if at least one profile is enabled
  const hasEnabledProfile = useMemo(() => config.securityProfiles.some((p) => p.enabled), [config.securityProfiles])

  // Handle adding a new profile
  const handleAddProfile = useCallback(() => {
    setEditingProfile(undefined)
    setIsModalOpen(true)
  }, [])

  // Handle editing an existing profile
  const handleEditProfile = useCallback((profile: OpcUaSecurityProfile) => {
    setEditingProfile(profile)
    setIsModalOpen(true)
  }, [])

  // Handle saving a profile (add or update)
  const handleSaveProfile = useCallback(
    (profile: OpcUaSecurityProfile) => {
      if (editingProfile) {
        updateOpcUaSecurityProfile(serverName, profile.id, profile)
      } else {
        addOpcUaSecurityProfile(serverName, profile)
      }
      onConfigChange()
    },
    [serverName, editingProfile, addOpcUaSecurityProfile, updateOpcUaSecurityProfile, onConfigChange],
  )

  // Handle deleting a profile
  const handleDeleteProfile = useCallback(
    (profileId: string) => {
      const result = removeOpcUaSecurityProfile(serverName, profileId)
      if (result.ok) {
        onConfigChange()
      }
    },
    [serverName, removeOpcUaSecurityProfile, onConfigChange],
  )

  // Handle toggling profile enabled state
  const handleToggleEnabled = useCallback(
    (profile: OpcUaSecurityProfile) => {
      // Don't allow disabling if it's the last enabled profile
      if (profile.enabled) {
        const enabledCount = config.securityProfiles.filter((p) => p.enabled).length
        if (enabledCount <= 1) {
          return // Can't disable the last enabled profile
        }
      }
      updateOpcUaSecurityProfile(serverName, profile.id, { enabled: !profile.enabled })
      onConfigChange()
    },
    [serverName, config.securityProfiles, updateOpcUaSecurityProfile, onConfigChange],
  )

  return (
    <div className='flex flex-col gap-4'>
      {/* Header and description */}
      <div className='flex flex-col gap-2'>
        <p className='text-xs text-neutral-600 dark:text-neutral-400'>
          Configure which security profiles clients can use to connect. At least one profile must be enabled.
        </p>
      </div>

      {/* Warning if no profiles are enabled */}
      {!hasEnabledProfile && (
        <div className='rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900'>
          <p className='text-xs text-neutral-700 dark:text-neutral-300'>
            Warning: At least one security profile must be enabled for clients to connect.
          </p>
        </div>
      )}

      {/* Add Profile Button */}
      <button
        type='button'
        onClick={handleAddProfile}
        className='flex w-fit items-center gap-2 rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark'
      >
        <PlusIcon className='h-4 w-4' />
        Add Security Profile
      </button>

      {/* Security Profiles Table */}
      {config.securityProfiles.length > 0 ? (
        <div className='overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700'>
          <table className='w-full'>
            <thead className='bg-neutral-100 dark:bg-neutral-900'>
              <tr>
                <th className='px-3 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                  Enabled
                </th>
                <th className='px-3 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>Name</th>
                <th className='px-3 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                  Policy
                </th>
                <th className='px-3 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>Mode</th>
                <th className='px-3 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                  Authentication
                </th>
                <th className='px-3 py-2 text-right text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {config.securityProfiles.map((profile) => {
                const isLastEnabled = profile.enabled && config.securityProfiles.filter((p) => p.enabled).length <= 1
                return (
                  <tr key={profile.id} className='border-t border-neutral-200 dark:border-neutral-700'>
                    <td className='px-3 py-2'>
                      <label className='relative inline-flex cursor-pointer items-center'>
                        <input
                          type='checkbox'
                          checked={profile.enabled}
                          onChange={() => handleToggleEnabled(profile)}
                          className='peer sr-only'
                          disabled={isLastEnabled}
                        />
                        <div
                          className={cn(
                            'h-5 w-9 rounded-full bg-neutral-300 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[""]',
                            'peer-checked:bg-brand peer-checked:after:translate-x-full',
                            'dark:bg-neutral-700 dark:peer-checked:bg-brand',
                            isLastEnabled && 'cursor-not-allowed opacity-50',
                          )}
                        />
                      </label>
                    </td>
                    <td className='px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100'>{profile.name}</td>
                    <td className='px-3 py-2 text-sm text-neutral-600 dark:text-neutral-400'>
                      {profile.securityPolicy}
                    </td>
                    <td className='px-3 py-2 text-sm text-neutral-600 dark:text-neutral-400'>{profile.securityMode}</td>
                    <td className='px-3 py-2 text-sm text-neutral-600 dark:text-neutral-400'>
                      {formatAuthMethods(profile.authMethods)}
                    </td>
                    <td className='px-3 py-2 text-right'>
                      <div className='flex justify-end gap-2'>
                        <button
                          type='button'
                          onClick={() => handleEditProfile(profile)}
                          className='rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200'
                          title='Edit'
                        >
                          <Pencil1Icon className='h-4 w-4' />
                        </button>
                        <button
                          type='button'
                          onClick={() => handleDeleteProfile(profile.id)}
                          disabled={config.securityProfiles.length <= 1}
                          className={cn(
                            'rounded p-1 text-neutral-500 hover:bg-red-100 hover:text-red-600 dark:text-neutral-400 dark:hover:bg-red-900/30 dark:hover:text-red-400',
                            config.securityProfiles.length <= 1 && 'cursor-not-allowed opacity-50',
                          )}
                          title='Delete'
                        >
                          <TrashIcon className='h-4 w-4' />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className='text-sm text-neutral-500 dark:text-neutral-400'>
          No security profiles configured. Add a profile to allow clients to connect.
        </p>
      )}

      {/* Note about certificates */}
      <div className='mt-2 border-t border-neutral-200 pt-4 dark:border-neutral-800'>
        <p className='text-xs text-neutral-500 dark:text-neutral-400'>
          Note: Security profiles with Certificate authentication require trusted client certificates to be configured
          in the Certificates tab.
        </p>
      </div>

      {/* Modal for adding/editing profiles */}
      <SecurityProfileModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveProfile}
        existingProfile={editingProfile}
        existingNames={existingNames}
      />
    </div>
  )
}
