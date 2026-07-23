import { useEffect, useState } from 'react'

import type { RuntimeUserRole } from '../../../../middleware/shared/ports/runtime-port'
import { Label } from '../../_atoms/label'
import { Modal, ModalContent, ModalTitle } from '../../_molecules/modal'

/**
 * Normalized result of the form. `*Changed` flags let the caller send only the
 * fields the user actually touched — critically, `password` is present ONLY
 * when the password field was genuinely edited, so an untouched form never
 * resets a password.
 */
export interface RuntimeUserModalSubmit {
  username: string
  role?: RuntimeUserRole
  password?: string
  currentPassword?: string
  usernameChanged: boolean
  passwordChanged: boolean
  roleChanged: boolean
}

interface RuntimeUserModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** bootstrap = first-user setup, create = admin adding a user, edit = modify existing. */
  mode: 'bootstrap' | 'create' | 'edit'
  title: string
  description?: string
  submitLabel: string
  /** Prefill (edit mode). */
  initialUsername?: string
  initialRole?: RuntimeUserRole
  /** Show the Role selector (admin managing accounts). */
  showRole?: boolean
  /** Editing your OWN account: a password change must be confirmed with the
   *  current password (blocks a stolen session from silently resetting it). */
  requireCurrentPassword?: boolean
  /** Returns an error message to display, or null on success (which closes the modal). */
  onSubmit: (values: RuntimeUserModalSubmit) => Promise<string | null>
}

// Eight bullets shown in a password field in edit mode so it *looks* populated
// without ever holding (or submitting) a real password. Cleared on first edit.
const PASSWORD_PLACEHOLDER = '••••••••'

const inputClass =
  'w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-850 outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300'

const RuntimeUserModal = (props: RuntimeUserModalProps) => {
  const {
    open,
    onOpenChange,
    mode,
    title,
    description,
    submitLabel,
    initialUsername = '',
    initialRole = 'user',
    showRole = false,
    requireCurrentPassword = false,
    onSubmit,
  } = props

  const isEdit = mode === 'edit'

  const [username, setUsername] = useState(initialUsername)
  const [role, setRole] = useState<RuntimeUserRole>(initialRole)
  // In edit mode the password fields start as a masked placeholder; a real
  // change is only registered once the user focuses and types (passwordTouched).
  const [password, setPassword] = useState(isEdit ? PASSWORD_PLACEHOLDER : '')
  const [confirmPassword, setConfirmPassword] = useState(isEdit ? PASSWORD_PLACEHOLDER : '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [passwordTouched, setPasswordTouched] = useState(false)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  // Reset every field when the modal (re)opens, so a reused instance never
  // leaks state between the account it was last opened for and the next.
  useEffect(() => {
    if (open) {
      setUsername(initialUsername)
      setRole(initialRole)
      setPassword(isEdit ? PASSWORD_PLACEHOLDER : '')
      setConfirmPassword(isEdit ? PASSWORD_PLACEHOLDER : '')
      setCurrentPassword('')
      setPasswordTouched(false)
      setError('')
      setIsLoading(false)
    }
  }, [open, initialUsername, initialRole, isEdit])

  // First interaction with the password fields (edit mode) clears the masked
  // placeholder from BOTH inputs so the placeholder can never be submitted.
  const beginPasswordEdit = () => {
    if (isEdit && !passwordTouched) {
      setPassword('')
      setConfirmPassword('')
      setPasswordTouched(true)
    }
  }

  const handleSubmit = async () => {
    setError('')

    // A password counts as changed only when actually edited to a non-empty value.
    const passwordChanged = isEdit ? passwordTouched && password.length > 0 : true
    const usernameTrimmed = username.trim()
    const usernameChanged = isEdit ? usernameTrimmed !== initialUsername : true
    const roleChanged = showRole ? role !== initialRole : false

    if (!usernameTrimmed) {
      setError('Username is required')
      return
    }

    if (passwordChanged) {
      if (!password) {
        setError('Password is required')
        return
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match')
        return
      }
      if (requireCurrentPassword && !currentPassword) {
        setError('Your current password is required to change the password')
        return
      }
    }

    if (isEdit && !usernameChanged && !passwordChanged && !roleChanged) {
      setError('No changes to save')
      return
    }

    setIsLoading(true)
    try {
      const result = await onSubmit({
        username: usernameTrimmed,
        role: showRole ? role : undefined,
        password: passwordChanged ? password : undefined,
        currentPassword: passwordChanged && requireCurrentPassword ? currentPassword : undefined,
        usernameChanged,
        passwordChanged,
        roleChanged,
      })
      if (result) {
        setError(result)
      } else {
        onOpenChange(false)
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className='flex w-[400px] select-none flex-col items-center justify-start rounded-lg p-6'>
        <ModalTitle className='mb-4 text-xl font-semibold'>{title}</ModalTitle>

        {description && (
          <p className='mb-6 text-center text-sm text-neutral-600 dark:text-neutral-400'>{description}</p>
        )}

        <form
          autoComplete='off'
          onSubmit={(e) => {
            e.preventDefault()
            void handleSubmit()
          }}
          className='flex w-full flex-col gap-4'
        >
          <div>
            <Label htmlFor='runtime-user-name' className='mb-2 block text-sm'>
              Username
            </Label>
            <input
              id='runtime-user-name'
              name='runtime-user-name'
              type='text'
              autoComplete='off'
              autoCapitalize='none'
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder='Enter username'
              className={inputClass}
              disabled={isLoading}
            />
          </div>

          {showRole && (
            <div>
              <Label htmlFor='runtime-user-role' className='mb-2 block text-sm'>
                Role
              </Label>
              <select
                id='runtime-user-role'
                value={role}
                onChange={(e) => setRole(e.target.value as RuntimeUserRole)}
                className={inputClass}
                disabled={isLoading}
              >
                <option value='admin'>Admin</option>
                <option value='user'>User</option>
              </select>
            </div>
          )}

          <div>
            <Label htmlFor='runtime-user-pass' className='mb-2 block text-sm'>
              {isEdit ? 'New password' : 'Password'}
            </Label>
            <input
              id='runtime-user-pass'
              name='runtime-user-pass'
              type='password'
              autoComplete='new-password'
              value={password}
              onFocus={beginPasswordEdit}
              onChange={(e) => setPassword(e.target.value)}
              placeholder='Enter password'
              className={inputClass}
              disabled={isLoading}
            />
          </div>

          <div>
            <Label htmlFor='runtime-user-pass-confirm' className='mb-2 block text-sm'>
              Confirm password
            </Label>
            <input
              id='runtime-user-pass-confirm'
              name='runtime-user-pass-confirm'
              type='password'
              autoComplete='new-password'
              value={confirmPassword}
              onFocus={beginPasswordEdit}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder='Confirm password'
              className={inputClass}
              disabled={isLoading}
            />
          </div>

          {/* Rendered last, and only once the password is actually being
              changed, so adding it doesn't shove the field the user just
              clicked (the new-password field) down the form. */}
          {isEdit && requireCurrentPassword && passwordTouched && (
            <div>
              <Label htmlFor='runtime-user-current-pass' className='mb-2 block text-sm'>
                Current password
              </Label>
              <input
                id='runtime-user-current-pass'
                name='runtime-user-current-pass'
                type='password'
                autoComplete='off'
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder='Enter your current password'
                className={inputClass}
                disabled={isLoading}
              />
            </div>
          )}

          {error && <p className='text-sm text-red-600 dark:text-red-400'>{error}</p>}

          <div className='mt-2 flex gap-3'>
            <button
              type='submit'
              disabled={isLoading}
              className='flex-1 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark disabled:opacity-50'
            >
              {isLoading ? 'Saving...' : submitLabel}
            </button>
            <button
              type='button'
              onClick={() => onOpenChange(false)}
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

export { RuntimeUserModal }
