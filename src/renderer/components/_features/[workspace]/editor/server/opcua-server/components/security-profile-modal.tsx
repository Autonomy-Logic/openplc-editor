import { Checkbox } from '@root/renderer/components/_atoms/checkbox'
import { InputWithRef } from '@root/renderer/components/_atoms/input'
import { Label } from '@root/renderer/components/_atoms/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@root/renderer/components/_atoms/select'
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '@root/renderer/components/_molecules/modal'
import type { OpcUaSecurityProfile } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'

type SecurityPolicy = 'None' | 'Basic128Rsa15' | 'Basic256' | 'Basic256Sha256'
type SecurityMode = 'None' | 'Sign' | 'SignAndEncrypt'
type AuthMethod = 'Anonymous' | 'Username' | 'Certificate'

interface SecurityProfileModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (profile: OpcUaSecurityProfile) => void
  existingProfile?: OpcUaSecurityProfile
  existingNames: string[]
}

const inputStyles =
  'h-[30px] w-full rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'

const SECURITY_POLICIES: { value: SecurityPolicy; label: string }[] = [
  { value: 'None', label: 'None (No Security)' },
  { value: 'Basic128Rsa15', label: 'Basic128Rsa15' },
  { value: 'Basic256', label: 'Basic256' },
  { value: 'Basic256Sha256', label: 'Basic256Sha256 (Recommended)' },
]

const SECURITY_MODES: { value: SecurityMode; label: string }[] = [
  { value: 'None', label: 'None' },
  { value: 'Sign', label: 'Sign Only' },
  { value: 'SignAndEncrypt', label: 'Sign and Encrypt' },
]

export const SecurityProfileModal = ({
  isOpen,
  onClose,
  onSave,
  existingProfile,
  existingNames,
}: SecurityProfileModalProps) => {
  const isEditing = !!existingProfile

  // Form state
  const [name, setName] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [securityPolicy, setSecurityPolicy] = useState<SecurityPolicy>('None')
  const [securityMode, setSecurityMode] = useState<SecurityMode>('None')
  const [authMethods, setAuthMethods] = useState<AuthMethod[]>(['Anonymous'])

  // Reset form when modal opens/closes or profile changes
  useEffect(() => {
    if (isOpen && existingProfile) {
      setName(existingProfile.name)
      setEnabled(existingProfile.enabled)
      setSecurityPolicy(existingProfile.securityPolicy)
      setSecurityMode(existingProfile.securityMode)
      setAuthMethods(existingProfile.authMethods)
    } else if (isOpen && !existingProfile) {
      // Reset to defaults for new profile
      setName('')
      setEnabled(true)
      setSecurityPolicy('None')
      setSecurityMode('None')
      setAuthMethods(['Anonymous'])
    }
  }, [isOpen, existingProfile])

  // Validation rules
  const validationErrors = useMemo(() => {
    const errors: string[] = []

    // Name validation
    if (!name.trim()) {
      errors.push('Profile name is required')
    } else if (name.length > 64) {
      errors.push('Profile name must be 64 characters or less')
    } else {
      // Check for duplicate name (case insensitive), excluding current profile when editing
      const isDuplicate = existingNames.some(
        (existingName) =>
          existingName.toLowerCase() === name.trim().toLowerCase() &&
          (!existingProfile || existingName.toLowerCase() !== existingProfile.name.toLowerCase()),
      )
      if (isDuplicate) {
        errors.push('A profile with this name already exists')
      }
    }

    // Security Policy + Mode validation
    if (securityPolicy === 'None' && securityMode !== 'None') {
      errors.push('Security Mode must be "None" when Security Policy is "None"')
    }
    if (securityPolicy !== 'None' && securityMode === 'None') {
      errors.push('Security Mode cannot be "None" when using a security policy')
    }

    // Anonymous validation
    if (authMethods.includes('Anonymous') && securityPolicy !== 'None') {
      errors.push('Anonymous authentication is only available with Security Policy "None"')
    }

    // At least one auth method required
    if (authMethods.length === 0) {
      errors.push('At least one authentication method is required')
    }

    return errors
  }, [name, securityPolicy, securityMode, authMethods, existingNames, existingProfile])

  const isValid = validationErrors.length === 0

  // Handle security policy change - auto-adjust mode if needed
  const handleSecurityPolicyChange = useCallback((policy: SecurityPolicy) => {
    setSecurityPolicy(policy)
    if (policy === 'None') {
      setSecurityMode('None')
      // Anonymous is only valid with None policy, so add it if no auth methods
      setAuthMethods((prev) => {
        if (prev.length === 0) return ['Anonymous']
        return prev
      })
    } else {
      // If switching from None to a real policy, remove Anonymous and set a valid mode
      setAuthMethods((prev) => prev.filter((m) => m !== 'Anonymous'))
      setSecurityMode((prev) => (prev === 'None' ? 'SignAndEncrypt' : prev))
    }
  }, [])

  // Handle auth method toggle
  const toggleAuthMethod = useCallback(
    (method: AuthMethod) => {
      setAuthMethods((prev) => {
        if (prev.includes(method)) {
          // Don't allow removing the last auth method
          if (prev.length === 1) return prev
          return prev.filter((m) => m !== method)
        }
        // Don't allow Anonymous with non-None policy
        if (method === 'Anonymous' && securityPolicy !== 'None') {
          return prev
        }
        return [...prev, method]
      })
    },
    [securityPolicy],
  )

  // Handle save
  const handleSave = useCallback(() => {
    if (!isValid) return

    const profile: OpcUaSecurityProfile = {
      id: existingProfile?.id ?? uuidv4(),
      name: name.trim(),
      enabled,
      securityPolicy,
      securityMode,
      authMethods,
    }

    onSave(profile)
    onClose()
  }, [isValid, name, enabled, securityPolicy, securityMode, authMethods, existingProfile, onSave, onClose])

  return (
    <Modal open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <ModalContent className='h-auto max-h-[90vh] w-[500px]' onClose={onClose}>
        <ModalHeader>
          <ModalTitle>{isEditing ? 'Edit Security Profile' : 'Add Security Profile'}</ModalTitle>
        </ModalHeader>

        <div className='flex flex-1 flex-col gap-4 overflow-y-auto'>
          {/* Profile Name */}
          <div className='flex flex-col gap-2'>
            <Label className='text-xs font-semibold text-neutral-950 dark:text-white'>Profile Name</Label>
            <InputWithRef
              type='text'
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='e.g., secure_encrypted'
              maxLength={64}
              className={inputStyles}
            />
            <span className='text-xs text-neutral-500 dark:text-neutral-400'>Unique identifier for this profile</span>
          </div>

          {/* Enable Toggle */}
          <div className='flex items-center gap-4'>
            <Label className='text-xs font-semibold text-neutral-950 dark:text-white'>Enabled</Label>
            <label className='relative inline-flex cursor-pointer items-center'>
              <input
                type='checkbox'
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className='peer sr-only'
              />
              <div
                className={cn(
                  'h-6 w-11 rounded-full bg-neutral-300 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[""]',
                  'peer-checked:bg-brand peer-checked:after:translate-x-full',
                  'dark:bg-neutral-700 dark:peer-checked:bg-brand',
                )}
              />
            </label>
          </div>

          {/* Security Settings Section */}
          <div className='flex flex-col gap-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900'>
            <h4 className='font-caption text-xs font-semibold text-neutral-950 dark:text-white'>Security Settings</h4>

            {/* Security Policy */}
            <div className='flex flex-col gap-2'>
              <Label className='text-xs text-neutral-950 dark:text-white'>Security Policy</Label>
              <Select value={securityPolicy} onValueChange={(v) => handleSecurityPolicyChange(v as SecurityPolicy)}>
                <SelectTrigger
                  withIndicator
                  placeholder='Select policy'
                  className='flex h-[30px] w-full items-center justify-between gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
                />
                <SelectContent className='h-fit max-h-[200px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-300 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'>
                  {SECURITY_POLICIES.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      className={cn(
                        'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
                        'flex w-full cursor-pointer items-center justify-start px-2 py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800',
                      )}
                    >
                      <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                        {option.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Security Mode */}
            <div className='flex flex-col gap-2'>
              <Label className='text-xs text-neutral-950 dark:text-white'>Security Mode</Label>
              <Select
                value={securityMode}
                onValueChange={(v) => setSecurityMode(v as SecurityMode)}
                disabled={securityPolicy === 'None'}
              >
                <SelectTrigger
                  withIndicator
                  placeholder='Select mode'
                  className={cn(
                    'flex h-[30px] w-full items-center justify-between gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300',
                    securityPolicy === 'None' && 'cursor-not-allowed opacity-50',
                  )}
                />
                <SelectContent className='h-fit max-h-[200px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-300 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'>
                  {SECURITY_MODES.filter((m) =>
                    securityPolicy === 'None' ? m.value === 'None' : m.value !== 'None',
                  ).map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      className={cn(
                        'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
                        'flex w-full cursor-pointer items-center justify-start px-2 py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800',
                      )}
                    >
                      <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                        {option.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {securityPolicy === 'None' && (
                <span className='text-xs text-neutral-500 dark:text-neutral-400'>
                  Security Mode is fixed to "None" when Security Policy is "None"
                </span>
              )}
            </div>
          </div>

          {/* Authentication Methods Section */}
          <div className='flex flex-col gap-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900'>
            <h4 className='font-caption text-xs font-semibold text-neutral-950 dark:text-white'>
              Authentication Methods
            </h4>
            <p className='text-xs text-neutral-500 dark:text-neutral-400'>
              Select at least one authentication method for this profile.
            </p>

            {/* Anonymous */}
            <div className='flex items-center gap-3'>
              <Checkbox
                checked={authMethods.includes('Anonymous')}
                onCheckedChange={() => toggleAuthMethod('Anonymous')}
                disabled={securityPolicy !== 'None'}
              />
              <div className='flex flex-col'>
                <Label
                  className={cn('text-xs text-neutral-950 dark:text-white', securityPolicy !== 'None' && 'opacity-50')}
                >
                  Anonymous
                </Label>
                <span className='text-xs text-neutral-500 dark:text-neutral-400'>
                  {securityPolicy !== 'None'
                    ? 'Only available with Security Policy "None"'
                    : 'No authentication required'}
                </span>
              </div>
            </div>

            {/* Username */}
            <div className='flex items-center gap-3'>
              <Checkbox
                checked={authMethods.includes('Username')}
                onCheckedChange={() => toggleAuthMethod('Username')}
              />
              <div className='flex flex-col'>
                <Label className='text-xs text-neutral-950 dark:text-white'>Username / Password</Label>
                <span className='text-xs text-neutral-500 dark:text-neutral-400'>
                  Users must be configured in the Users tab
                </span>
              </div>
            </div>

            {/* Certificate */}
            <div className='flex items-center gap-3'>
              <Checkbox
                checked={authMethods.includes('Certificate')}
                onCheckedChange={() => toggleAuthMethod('Certificate')}
              />
              <div className='flex flex-col'>
                <Label className='text-xs text-neutral-950 dark:text-white'>Certificate</Label>
                <span className='text-xs text-neutral-500 dark:text-neutral-400'>
                  Client certificates must be added to trusted list
                </span>
              </div>
            </div>
          </div>

          {/* Validation Errors */}
          {validationErrors.length > 0 && (
            <div className='rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950'>
              <ul className='list-inside list-disc space-y-1'>
                {validationErrors.map((error, index) => (
                  <li key={index} className='text-xs text-red-600 dark:text-red-400'>
                    {error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <ModalFooter className='mt-4 flex justify-end gap-2'>
          <button
            type='button'
            onClick={onClose}
            className='h-[32px] rounded-md border border-neutral-300 bg-white px-4 font-caption text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700'
          >
            Cancel
          </button>
          <button
            type='button'
            onClick={handleSave}
            disabled={!isValid}
            className={cn(
              'h-[32px] rounded-md bg-brand px-4 font-caption text-xs font-medium text-white hover:bg-brand-medium-dark',
              !isValid && 'cursor-not-allowed opacity-50',
            )}
          >
            {isEditing ? 'Save Changes' : 'Add Profile'}
          </button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
