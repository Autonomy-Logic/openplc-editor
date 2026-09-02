import { zodResolver } from '@hookform/resolvers/zod'
import { Eye, EyeOff, Mail } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import type { EdgeAccountPort, EdgeSignInOutcome } from '../../../../middleware/shared/ports/edge-account-port'
import { AutonomyLogo } from '../../_atoms/autonomy-logo'
import { ProviderIcon } from '../../_atoms/provider-icons'
import { Modal, ModalContent, ModalTitle } from '../../_molecules/modal'

/**
 * Sign in to Autonomy Edge from inside the editor.
 *
 * A copy of Edge's own sign-in screen, down to the mark, the headings and the
 * strings: same account, same credentials, so a screen that looked different would
 * read as a less trustworthy login. Text is taken verbatim from Edge's `auth.json`
 * locale file rather than paraphrased.
 *
 * The one deliberate difference is density. Edge lays this out down a full page;
 * here it has to fit a dialog without scrolling, so the vertical rhythm is
 * compressed — no gap is decorative, and the provider row is three across.
 *
 * NOT the same thing as `RuntimeLoginModal`, which authenticates against a PLC
 * runtime device. The subtitle names the account for exactly that reason.
 *
 * Provider buttons are links, not handlers: the consent screen has to render as a
 * top-level navigation, and a provider refuses to be framed or fetched.
 */
const signInSchema = z.object({
  email: z.string().min(1, 'Enter your email').email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
})

type SignInValues = z.infer<typeof signInSchema>

interface EdgeSignInModalProps {
  open: boolean
  /**
   * Requests a close, on a build where this dialog is dismissible.
   *
   * Absent where an account is required: there the dialog IS the screen, and letting
   * it close would leave the user looking at an editor with no project in it and no
   * way back. Present where signing in is optional, because a dialog the user opened
   * has to be one they can also close.
   */
  onOpenChange?: (open: boolean) => void
  onSignedIn: () => void
  /**
   * The platform's Edge account port: signing in, the provider list and where
   * Edge's own pages live. Passed in rather than imported — this component lives
   * in a surface the desktop editor mirrors, and reaching into the web adapter
   * would compile that build against an API it does not speak.
   */
  account: EdgeAccountPort
  /**
   * Why the user is being asked to sign in. Each of these is a different person
   * with a different question, and one greeting cannot answer all of them:
   *
   *  - `expired`: they were editing and the session died under them. "Welcome to
   *    OpenPLC Editor" answers a question they never asked and ignores the one
   *    they have — what just happened, and did I lose my work?
   *  - `expired-reloaded`: the same expiry, but reached through a reload. Split
   *    from `expired` for one reason: the in-memory reassurance is false here.
   *  - `sign-in-required`: they followed a project link and are not signed in.
   *    Nothing ended and nothing was lost; they just need to know why a login is
   *    standing between them and the project.
   *  - `oauth-failed`: a provider round-trip came back without a session.
   *  - `signed-out` (default): the plain "you are not signed in" case.
   */
  reason?: 'expired' | 'expired-reloaded' | 'sign-in-required' | 'oauth-failed' | 'signed-out'
}

/** Heading and supporting line for each reason the dialog can appear for. */
const REASON_COPY = {
  expired: {
    title: 'Your session has expired',
    // True here and NOWHERE else: this dialog is drawn over the live editor, so
    // the open project and every unsaved edit are still in memory behind it.
    subtitle: 'Sign in again to keep working. Nothing you typed is lost.',
  },
  'expired-reloaded': {
    title: 'Your session has expired',
    // Same expiry, one reload later — and that reload already discarded whatever
    // was unsaved, because the web build holds the project in memory with nothing
    // persisting it. Reusing the line above would promise the user their work was
    // safe at the exact moment it was not. What IS true is that saved work comes
    // back with them.
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
    formState: { errors },
  } = useForm<SignInValues>({ resolver: zodResolver(signInSchema) })

  // The editor's own origin. The provider flow opens in a separate tab and lands
  // on `/oauth-complete` there, so this tab — and the unsaved project in it — is
  // never navigated away from.
  const editorOrigin = typeof window === 'undefined' ? '' : window.location.origin

  // Password recovery is an email flow that only exists on Edge, so this is one
  // of the two links that still leave — there is nothing here to hand it to.
  const forgotPasswordUrl = new URL('/forgot-password', account.frontendBaseUrl).toString()
  // The other one. Registration is an Edge flow end to end (email verification,
  // plan selection, onboarding) and none of it belongs in an editor dialog, so
  // this hands off rather than pretending to start it here.
  const signUpUrl = new URL('/signup', account.frontendBaseUrl).toString()

  const onSubmit = async (values: SignInValues) => {
    setSubmitting(true)
    setFormState({ kind: 'idle' })

    // The port contracts every failure into an outcome — `failed` — so a rejection
    // is not a path the web adapter takes. Folded into that outcome anyway, because
    // the type system does not enforce the contract: an unhandled rejection here
    // would leave the button stuck on "Signing in…" having said nothing at all.
    const outcome = await account
      .signIn(values.email, values.password)
      .catch((): EdgeSignInOutcome => ({ status: 'failed' }))

    setSubmitting(false)

    switch (outcome.status) {
      case 'signed-in':
        onSignedIn()
        return
      // Correct password, unconfirmed address. Edge answers 200 for this, so
      // calling it a login failure would send the user hunting for a typo that
      // isn't there.
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
      {/* `h-fit`, not `h-auto`: ModalContent hardcodes `h-[500px]` (so the provider
          row rendered outside the dialog's border) AND positions itself with
          `fixed inset-0 m-auto` — under which `height: auto` means "stretch from
          top to bottom" and leaves a tall empty box. `max-h`/`overflow` then keep a
          short viewport scrolling the dialog rather than clipping it. */}
      <ModalContent className='flex h-fit max-h-[92vh] w-[400px] select-none flex-col gap-0 overflow-y-auto rounded-xl px-7 py-6'>
        {/* Sized container, as Edge does it: an SVG given only a height collapses
            its width to zero and the mark disappears. */}
        <div className='mb-3 flex items-center justify-center'>
          <AutonomyLogo className='h-9 w-auto text-brand' />
        </div>

        {/* The greeting names the app the user is actually in — welcoming them to
            Edge from inside the editor read as the wrong product — but only for
            someone who really is just arriving. Everyone else gets the sentence
            that explains their own situation; see REASON_COPY. */}
        <ModalTitle className='text-center text-xl font-normal text-neutral-900 dark:text-neutral-100'>
          {copy.title}
        </ModalTitle>
        <p className='text-center text-sm text-neutral-500 dark:text-neutral-400'>{copy.subtitle}</p>
        {/* Says out loud that these are the Edge credentials. Two logins live in
            this app — this one and the PLC runtime's — and the user needs to know
            which one is being asked for, and that no separate account exists. */}
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

          {/* No "Remember me": the session length is Edge's to decide and it is
              already a 30-day refresh cookie. A checkbox wired to nothing told the
              user they were choosing something they were not.

              `target='_blank'` for the same load-bearing reason as the providers
              and the sign-up link below — recovery is an email round-trip, and it
              must not navigate a tab holding an unsaved project. */}
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

        {/* Three across, icon only: the row Edge shows, and what keeps the dialog
            inside a laptop viewport without a scrollbar.

            `target='_blank'` is load-bearing, not a nicety. The open project lives
            in memory with nothing persisting it and the web build registers no
            beforeunload guard, so navigating this tab to a provider would discard
            every unsaved edit in silence. */}
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

        {/* Edge closes its sign-in screen with this and so does this dialog.
            It is load-bearing here in a way it is not there: the most common way
            to arrive at this dialog is a shared project link, and the person who
            followed it may not have an account at all. Without a way out, the
            dialog is a dead end for exactly the visitor it was shown to.

            `target='_blank'` for the same reason as the providers above — signing
            up is a long flow, and it must not navigate a tab that may be holding
            an unsaved project. */}
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
