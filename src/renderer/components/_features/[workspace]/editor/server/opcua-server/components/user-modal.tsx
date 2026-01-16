import { InputWithRef } from '@root/renderer/components/_atoms/input'
import { Label } from '@root/renderer/components/_atoms/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@root/renderer/components/_atoms/select'
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '@root/renderer/components/_molecules/modal'
import type { OpcUaTrustedCertificate, OpcUaUser } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'

type AuthType = 'password' | 'certificate'
type UserRole = 'viewer' | 'operator' | 'engineer'

interface UserModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (user: OpcUaUser) => void
  existingUser?: OpcUaUser
  existingUsernames: string[]
  trustedCertificates: OpcUaTrustedCertificate[]
  usedCertificateIds: string[]
}

const inputStyles =
  'h-[30px] w-full rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'

const ROLE_OPTIONS: { value: UserRole; label: string; description: string }[] = [
  { value: 'viewer', label: 'Viewer', description: 'Read-only access to all variables' },
  { value: 'operator', label: 'Operator', description: 'Read/Write based on per-variable permission settings' },
  { value: 'engineer', label: 'Engineer', description: 'Full administrative access' },
]

// Simple password hashing using SHA-256 (Web Crypto API)
// Note: For production, consider using bcrypt or similar
const hashPassword = async (password: string): Promise<string> => {
  const encoder = new TextEncoder()
  const data = encoder.encode(password)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const UserModal = ({
  isOpen,
  onClose,
  onSave,
  existingUser,
  existingUsernames,
  trustedCertificates,
  usedCertificateIds,
}: UserModalProps) => {
  const isEditing = !!existingUser

  // Form state
  const [authType, setAuthType] = useState<AuthType>('password')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [certificateId, setCertificateId] = useState<string | null>(null)
  const [role, setRole] = useState<UserRole>('operator')

  // Reset form when modal opens/closes or user changes
  useEffect(() => {
    if (isOpen && existingUser) {
      setAuthType(existingUser.type)
      setUsername(existingUser.username ?? '')
      setPassword('')
      setConfirmPassword('')
      setShowPassword(false)
      setCertificateId(existingUser.certificateId)
      setRole(existingUser.role)
    } else if (isOpen && !existingUser) {
      // Reset to defaults for new user
      setAuthType('password')
      setUsername('')
      setPassword('')
      setConfirmPassword('')
      setShowPassword(false)
      setCertificateId(null)
      setRole('operator')
    }
  }, [isOpen, existingUser])

  // Available certificates (not bound to other users, or bound to current user when editing)
  const availableCertificates = useMemo(() => {
    return trustedCertificates.filter(
      (cert) => !usedCertificateIds.includes(cert.id) || existingUser?.certificateId === cert.id,
    )
  }, [trustedCertificates, usedCertificateIds, existingUser])

  // Validation rules
  const validationErrors = useMemo(() => {
    const errors: string[] = []

    if (authType === 'password') {
      // Username validation
      if (!username.trim()) {
        errors.push('Username is required')
      } else if (username.length > 64) {
        errors.push('Username must be 64 characters or less')
      } else {
        // Check for duplicate username (case insensitive), excluding current user when editing
        const isDuplicate = existingUsernames.some(
          (existingName) =>
            existingName.toLowerCase() === username.trim().toLowerCase() &&
            (!existingUser || existingUser.username?.toLowerCase() !== existingName.toLowerCase()),
        )
        if (isDuplicate) {
          errors.push('A user with this username already exists')
        }
      }

      // Password validation (only required for new users or when changing password)
      if (!isEditing || password) {
        if (!password) {
          errors.push('Password is required')
        } else if (password.length < 4) {
          errors.push('Password must be at least 4 characters')
        } else if (password !== confirmPassword) {
          errors.push('Passwords do not match')
        }
      }
    } else {
      // Certificate validation
      if (!certificateId) {
        errors.push('Please select a certificate')
      }
      if (availableCertificates.length === 0 && !existingUser?.certificateId) {
        errors.push('No trusted certificates available. Add certificates in the Certificates tab first.')
      }
    }

    return errors
  }, [
    authType,
    username,
    password,
    confirmPassword,
    certificateId,
    existingUsernames,
    existingUser,
    isEditing,
    availableCertificates,
  ])

  const isValid = validationErrors.length === 0

  // Handle save
  const handleSave = useCallback(async () => {
    if (!isValid) return

    let passwordHash: string | null = null

    if (authType === 'password' && password) {
      passwordHash = await hashPassword(password)
    } else if (authType === 'password' && isEditing && existingUser?.passwordHash) {
      // Keep existing password hash if not changing
      passwordHash = existingUser.passwordHash
    }

    const user: OpcUaUser = {
      id: existingUser?.id ?? uuidv4(),
      type: authType,
      username: authType === 'password' ? username.trim() : null,
      passwordHash: authType === 'password' ? passwordHash : null,
      certificateId: authType === 'certificate' ? certificateId : null,
      role,
    }

    onSave(user)
    onClose()
  }, [isValid, authType, username, password, certificateId, role, existingUser, isEditing, onSave, onClose])

  return (
    <Modal open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <ModalContent className='h-auto max-h-[90vh] w-[500px]' onClose={onClose}>
        <ModalHeader>
          <ModalTitle>{isEditing ? 'Edit User' : 'Add User'}</ModalTitle>
        </ModalHeader>

        <div className='flex flex-1 flex-col gap-4 overflow-y-auto'>
          {/* Authentication Type */}
          <div className='flex flex-col gap-2'>
            <Label className='text-xs font-semibold text-neutral-950 dark:text-white'>Authentication Type</Label>
            <Select value={authType} onValueChange={(v) => setAuthType(v as AuthType)}>
              <SelectTrigger
                withIndicator
                placeholder='Select type'
                className='flex h-[30px] w-full items-center justify-between gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
              />
              <SelectContent className='h-fit max-h-[200px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-300 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'>
                <SelectItem
                  value='password'
                  className={cn(
                    'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
                    'flex w-full cursor-pointer items-center justify-start px-2 py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800',
                  )}
                >
                  <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                    Password
                  </span>
                </SelectItem>
                <SelectItem
                  value='certificate'
                  className={cn(
                    'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
                    'flex w-full cursor-pointer items-center justify-start px-2 py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800',
                  )}
                >
                  <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                    Certificate
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Password Authentication Section */}
          {authType === 'password' && (
            <div className='flex flex-col gap-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900'>
              <h4 className='font-caption text-xs font-semibold text-neutral-950 dark:text-white'>
                Password Authentication
              </h4>

              {/* Username */}
              <div className='flex flex-col gap-2'>
                <Label className='text-xs text-neutral-950 dark:text-white'>Username</Label>
                <InputWithRef
                  type='text'
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder='e.g., operator1'
                  maxLength={64}
                  className={inputStyles}
                />
              </div>

              {/* Password */}
              <div className='flex flex-col gap-2'>
                <Label className='text-xs text-neutral-950 dark:text-white'>
                  {isEditing ? 'New Password (leave blank to keep current)' : 'Password'}
                </Label>
                <div className='relative'>
                  <InputWithRef
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder='••••••••'
                    className={cn(inputStyles, 'pr-10')}
                  />
                  <button
                    type='button'
                    onClick={() => setShowPassword(!showPassword)}
                    className='absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
                  >
                    {showPassword ? '🙈' : '👁'}
                  </button>
                </div>
              </div>

              {/* Confirm Password */}
              <div className='flex flex-col gap-2'>
                <Label className='text-xs text-neutral-950 dark:text-white'>Confirm Password</Label>
                <InputWithRef
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder='••••••••'
                  className={inputStyles}
                />
              </div>
            </div>
          )}

          {/* Certificate Authentication Section */}
          {authType === 'certificate' && (
            <div className='flex flex-col gap-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900'>
              <h4 className='font-caption text-xs font-semibold text-neutral-950 dark:text-white'>
                Certificate Authentication
              </h4>

              {availableCertificates.length === 0 ? (
                <p className='text-xs text-amber-600 dark:text-amber-400'>
                  No trusted certificates available. Add certificates in the Certificates tab first.
                </p>
              ) : (
                <div className='flex flex-col gap-2'>
                  <Label className='text-xs text-neutral-950 dark:text-white'>Client Certificate</Label>
                  <Select value={certificateId ?? ''} onValueChange={(v) => setCertificateId(v || null)}>
                    <SelectTrigger
                      withIndicator
                      placeholder='Select certificate'
                      className='flex h-[30px] w-full items-center justify-between gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
                    />
                    <SelectContent className='h-fit max-h-[200px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-300 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'>
                      {availableCertificates.map((cert) => (
                        <SelectItem
                          key={cert.id}
                          value={cert.id}
                          className={cn(
                            'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
                            'flex w-full cursor-pointer items-center justify-start px-2 py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800',
                          )}
                        >
                          <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                            {cert.id} {cert.subject && `(${cert.subject})`}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className='text-xs text-neutral-500 dark:text-neutral-400'>
                    Select from trusted certificates configured in the Certificates tab
                  </span>
                </div>
              )}
            </div>
          )}

          {/* User Role Section */}
          <div className='flex flex-col gap-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900'>
            <h4 className='font-caption text-xs font-semibold text-neutral-950 dark:text-white'>User Role</h4>

            <div className='flex flex-col gap-2'>
              <Label className='text-xs text-neutral-950 dark:text-white'>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
                <SelectTrigger
                  withIndicator
                  placeholder='Select role'
                  className='flex h-[30px] w-full items-center justify-between gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
                />
                <SelectContent className='h-fit max-h-[200px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-300 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'>
                  {ROLE_OPTIONS.map((option) => (
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

            {/* Role Descriptions */}
            <div className='mt-2 space-y-1'>
              {ROLE_OPTIONS.map((option) => (
                <p
                  key={option.value}
                  className={cn(
                    'text-xs',
                    role === option.value
                      ? 'font-medium text-neutral-950 dark:text-white'
                      : 'text-neutral-500 dark:text-neutral-400',
                  )}
                >
                  • {option.label}: {option.description}
                </p>
              ))}
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
            onClick={() => void handleSave()}
            disabled={!isValid}
            className={cn(
              'h-[32px] rounded-md bg-brand px-4 font-caption text-xs font-medium text-white hover:bg-brand-medium-dark',
              !isValid && 'cursor-not-allowed opacity-50',
            )}
          >
            {isEditing ? 'Save Changes' : 'Add User'}
          </button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
