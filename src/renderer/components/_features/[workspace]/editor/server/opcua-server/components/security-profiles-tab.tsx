import { useOpenPLCStore } from '@root/renderer/store'
import type { OpcUaSecurityProfile, OpcUaServerConfig } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import { useCallback, useMemo, useState } from 'react'

import { SecurityProfileModal } from './security-profile-modal'

interface SecurityProfilesTabProps {
  config: OpcUaServerConfig
  serverName: string
  onConfigChange: () => void
}

// Helper to get a human-readable description for a security profile
const getProfileDescription = (profile: OpcUaSecurityProfile): string => {
  if (profile.securityPolicy === 'None') {
    return 'No encryption or authentication. Use only for development/testing.'
  }
  if (profile.securityMode === 'Sign') {
    return 'Messages are signed but not encrypted.'
  }
  return 'Full security: messages are signed and encrypted.'
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
        <div className='rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950'>
          <p className='text-xs text-amber-700 dark:text-amber-400'>
            Warning: At least one security profile must be enabled for clients to connect.
          </p>
        </div>
      )}

      {/* Add Profile Button */}
      <button
        type='button'
        onClick={handleAddProfile}
        className='flex h-[36px] w-fit items-center gap-2 rounded-md border border-neutral-300 bg-white px-4 font-caption text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700'
      >
        <span className='text-lg leading-none'>+</span>
        Add Security Profile
      </button>

      {/* Security Profiles List */}
      <div className='flex flex-col gap-3'>
        {config.securityProfiles.map((profile) => (
          <div
            key={profile.id}
            className='flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900'
          >
            {/* Header row with toggle, name, and actions */}
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-4'>
                {/* Enable Toggle */}
                <label className='relative inline-flex cursor-pointer items-center'>
                  <input
                    type='checkbox'
                    checked={profile.enabled}
                    onChange={() => handleToggleEnabled(profile)}
                    className='peer sr-only'
                    disabled={profile.enabled && config.securityProfiles.filter((p) => p.enabled).length <= 1}
                  />
                  <div
                    className={cn(
                      'h-5 w-9 rounded-full bg-neutral-300 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[""]',
                      'peer-checked:bg-brand peer-checked:after:translate-x-full',
                      'dark:bg-neutral-700 dark:peer-checked:bg-brand',
                      profile.enabled &&
                        config.securityProfiles.filter((p) => p.enabled).length <= 1 &&
                        'cursor-not-allowed opacity-50',
                    )}
                  />
                </label>

                {/* Profile Name */}
                <span className='font-caption text-sm font-semibold text-neutral-950 dark:text-white'>
                  {profile.name}
                </span>
              </div>

              {/* Actions */}
              <div className='flex items-center gap-2'>
                <button
                  type='button'
                  onClick={() => handleEditProfile(profile)}
                  className='h-[28px] rounded-md border border-neutral-300 bg-white px-3 font-caption text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700'
                >
                  Edit
                </button>
                <button
                  type='button'
                  onClick={() => handleDeleteProfile(profile.id)}
                  disabled={config.securityProfiles.length <= 1}
                  className={cn(
                    'h-[28px] rounded-md border border-red-300 bg-white px-3 font-caption text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:bg-neutral-800 dark:text-red-400 dark:hover:bg-red-950',
                    config.securityProfiles.length <= 1 && 'cursor-not-allowed opacity-50',
                  )}
                >
                  Delete
                </button>
              </div>
            </div>

            {/* Profile Details */}
            <div className='flex flex-col gap-1 pl-[52px]'>
              <p className='font-caption text-xs text-neutral-600 dark:text-neutral-400'>
                <span className='font-medium'>Policy:</span> {profile.securityPolicy}
                {' | '}
                <span className='font-medium'>Mode:</span> {profile.securityMode}
              </p>
              <p className='font-caption text-xs text-neutral-600 dark:text-neutral-400'>
                <span className='font-medium'>Authentication:</span> {formatAuthMethods(profile.authMethods)}
              </p>
              <p className='font-caption text-xs text-neutral-500 dark:text-neutral-500'>
                {getProfileDescription(profile)}
              </p>

              {/* Warning for insecure profiles */}
              {profile.securityPolicy === 'None' && profile.enabled && (
                <div className='mt-2 rounded bg-amber-50 p-2 dark:bg-amber-950'>
                  <p className='text-xs text-amber-700 dark:text-amber-400'>
                    Warning: No encryption or authentication. Use only for development/testing.
                  </p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

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
