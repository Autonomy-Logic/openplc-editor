import { zodResolver } from '@hookform/resolvers/zod'
import { Eye, EyeOff, Mail } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import type { EdgeAccountPort, EdgeSignInOutcome } from '../../../../middleware/shared/ports/edge-account-port'
import { AutonomyLogo } from '../../_atoms/autonomy-logo'
import { ProviderIcon } from '../../_atoms/provider-icons'
import { Modal, ModalContent, ModalTitle } from '../../_molecules/modal'

// Not the same as RuntimeLoginModal (PLC runtime login).
// Provider buttons are links, not handlers: a provider refuses to be framed or fetched.
const signInSchema = z.object({
  email: z.string().min(1, 'Enter your email').email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
})

type SignInValues = z.infer<typeof signInSchema>

interface EdgeSignInModalProps {
  open: boolean
  /** Requests a close, on a build where this dialog is dismissible (absent where an account is required). */
  onOpenChange?: (open: boolean) => void
  onSignedIn: () => void
  account: EdgeAccountPort
  reason?: 'expired' | 'expired-reloaded' | 'sign-in-required' | 'oauth-failed' | 'signed-out'
}

/** Heading and supporting line for each reason the dialog can appear for. */
const REASON_COPY = {
  expired: {
    title: 'Your session has expired',
    // True here and nowhere else: the dialog is drawn over the live editor, so unsaved edits are still in memory.
    subtitle: 'Sign in again to keep working. Nothing you typed is lost.',
  },
  'expired-reloaded': {
    title: 'Your session has expired',
    // A reload already discarded whatever was unsaved (nothing persists it); only saved work comes back.
    subtitle: 'Sign in again to reopen your project. Everything you saved is safe on the server.',
  },
  'sign-in-required': {
    title: 'Sign in to open this project',
    subtitle: 'Projects are private to their owner and the people they are shared with.',
  },
  'oauth-failed': {
    title: 'That sign-in did not finish',
    subtitle: 'Try again, or use your email and password below.',
  },
  'signed-out': {
    title: 'Welcome to OpenPLC Editor',
    subtitle: 'Sign in to your account',
  },
} as const

type FormState = { kind: 'idle' } | { kind: 'error'; message: string } | { kind: 'unverified'; email: string }

const FIELD_CLASSES =
  'w-full rounded-lg border border-neutral-300 bg-transparent py-2 pr-9 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-brand dark:border-neutral-700 dark:text-neutral-100'

const EdgeSignInModal = ({ open, onOpenChange, onSignedIn, account, reason = 'signed-out' }: EdgeSignInModalProps) => {
  const copy = REASON_COPY[reason]
  const [formState, setFormState] = useState<FormState>({ kind: 'idle' })
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<SignInValues>({ resolver: zodResolver(signInSchema) })

  // Reset on every open: the caller keeps this component mounted and only flips `open`,
  // so stale form state and error messages would otherwise survive a close.
  useEffect(() => {
    if (!open) {
      return
    }

    setFormState({ kind: 'idle' })
    setSubmitting(false)
    setShowPassword(false)
    reset()
  }, [open, reset])

  // Provider flow opens in a separate tab and lands on /oauth-complete there, so this
  // tab (and its unsaved project) is never navigated away from.
  const editorOrigin = typeof window === 'undefined' ? '' : window.location.origin

  // Password recovery only exists as an Edge email flow, so this hands off rather than reimplementing it.
  const forgotPasswordUrl = new URL('/forgot-password', account.frontendBaseUrl).toString()
  const signUpUrl = new URL('/signup', account.frontendBaseUrl).toString()

  const onSubmit = async (values: SignInValues) => {
    setSubmitting(true)
    setFormState({ kind: 'idle' })

    // Nothing enforces the port's `failed`-on-error contract at the type level; catch here
    // so an unhandled rejection can't strand the button on "Signing in…".
    const outcome = await account
      .signIn(values.email, values.password)
      .catch((): EdgeSignInOutcome => ({ status: 'failed' }))

    setSubmitting(false)

    switch (outcome.status) {
      case 'signed-in':
        onSignedIn()
        return
      // Correct password, unconfirmed address - Edge answers 200, so this isn't a login failure.
      case 'email-unverified':
        setFormState({ kind: 'unverified', email: outcome.email })
        return
      case 'invalid-credentials':
        setFormState({ kind: 'error', message: 'Email or password is incorrect.' })
        return
      default:
        setFormState({ kind: 'error', message: 'Could not sign in. Check your connection and try again.' })
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      {/* h-fit, not h-auto: ModalContent's fixed positioning makes h-auto stretch full height;
          max-h/overflow then let a short viewport scroll instead of clipping. */}
      <ModalContent className='flex h-fit max-h-[92vh] w-[400px] select-none flex-col gap-0 overflow-y-auto rounded-xl px-7 py-6'>
        {/* An SVG given only a height collapses its width to zero and the mark disappears. */}
        <div className='mb-3 flex items-center justify-center'>
          <AutonomyLogo className='h-9 w-auto text-brand' />
        </div>

        <ModalTitle className='text-center text-xl font-normal text-neutral-900 dark:text-neutral-100'>
          {copy.title}
        </ModalTitle>
        <p className='text-center text-sm text-neutral-500 dark:text-neutral-400'>{copy.subtitle}</p>
        {/* States these are Edge credentials: two logins exist in this app, this one and the PLC runtime's. */}
        <p className='mb-5 text-center text-xs text-neutral-500 dark:text-neutral-400'>
          Use the same login as Autonomy Edge.
        </p>

        <form
          className='flex flex-col gap-3.5'
          onSubmit={(event) => {
            void handleSubmit(onSubmit)(event)
          }}
        >
          <div className='flex flex-col gap-1'>
            <label htmlFor='edge-signin-email' className='text-sm font-medium text-neutral-900 dark:text-neutral-100'>
              Email address
            </label>
            <div className='relative'>
              <Mail className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400' />
              <input
                id='edge-signin-email'
                type='email'
                autoComplete='email'
                placeholder='Enter your email'
                className={`${FIELD_CLASSES} pl-9`}
                {...register('email')}
              />
            </div>
            {errors.email && <span className='text-xs text-red-600'>{errors.email.message}</span>}
          </div>

          <div className='flex flex-col gap-1'>
            <label
              htmlFor='edge-signin-password'
              className='text-sm font-medium text-neutral-900 dark:text-neutral-100'
            >
              Password
            </label>
            <div className='relative'>
              <input
                id='edge-signin-password'
                type={showPassword ? 'text' : 'password'}
                autoComplete='current-password'
                placeholder='Enter your password'
                className={`${FIELD_CLASSES} pl-3`}
                {...register('password')}
              />
              <button
                type='button'
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword((shown) => !shown)}
                className='absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-brand'
              >
                {showPassword ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
              </button>
            </div>
            {errors.password ? (
              <span className='text-xs text-red-600'>{errors.password.message}</span>
            ) : (
              <span className='text-xs text-neutral-500 dark:text-neutral-400'>
                Your password must be at least 8 characters long
              </span>
            )}
          </div>

          {/* No "Remember me": session length is Edge's to decide. target='_blank' keeps recovery
              from navigating a tab that may hold an unsaved project. */}
          <div className='flex items-center justify-end'>
            <a
              href={forgotPasswordUrl}
              target='_blank'
              rel='noreferrer'
              className='cursor-pointer text-sm text-brand underline-offset-4 hover:underline'
            >
              Forgot your password?
            </a>
          </div>

          {formState.kind === 'error' && <p className='text-sm text-red-600'>{formState.message}</p>}

          {formState.kind === 'unverified' && (
            <p className='text-sm text-amber-600 dark:text-amber-500'>
              Confirm your email address first. Check the message sent to {formState.email}.
            </p>
          )}

          <button
            type='submit'
            disabled={submitting}
            className='w-full cursor-pointer rounded-lg bg-brand py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60'
          >
            {submitting ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <div className='my-4 flex items-center gap-3'>
          <span className='h-px flex-1 bg-neutral-200 dark:bg-neutral-800' />
          <span className='text-sm text-neutral-500 dark:text-neutral-400'>Or</span>
          <span className='h-px flex-1 bg-neutral-200 dark:bg-neutral-800' />
        </div>

        {/* target='_blank' is load-bearing, not a nicety: the open project lives in memory with
            nothing persisting it and no beforeunload guard, so navigating this tab would discard it. */}
        <div className='grid grid-cols-3 gap-3'>
          {account.oauthProviders.map((provider) => (
            <a
              key={provider.id}
              href={account.oauthUrl(provider.id, editorOrigin)}
              target='_blank'
              rel='noreferrer'
              aria-label={`Sign in with ${provider.label}`}
              className='flex cursor-pointer items-center justify-center rounded-lg border border-neutral-300 py-2.5 text-neutral-900 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800'
            >
              <ProviderIcon provider={provider.id} />
            </a>
          ))}
        </div>

        {/* The most common way to arrive here is a shared project link, so the visitor may have
            no account at all; target='_blank' for the same reason as the providers above. */}
        <p className='mt-5 text-center text-sm text-neutral-500 dark:text-neutral-400'>
          Don&apos;t have an account?{' '}
          <a
            href={signUpUrl}
            target='_blank'
            rel='noreferrer'
            className='cursor-pointer text-brand underline-offset-4 hover:underline'
          >
            Sign up
          </a>
        </p>
      </ModalContent>
    </Modal>
  )
}

export { EdgeSignInModal }
